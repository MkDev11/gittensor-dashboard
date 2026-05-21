'use client';

import React from 'react';
import { Box } from '@primer/react';
import { SearchIcon } from '@primer/octicons-react';

export function SearchBox({
  value,
  onChange,
  placeholder = 'Search…',
  size = 'sm',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  size?: 'sm' | 'md';
}) {
  const isMd = size === 'md';
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        px: 2,
        py: isMd ? '5px' : '4px',
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.default',
        color: 'fg.muted',
        minWidth: isMd ? 200 : 160,
        maxWidth: 320,
        flex: '1 1 auto',
        '&:focus-within': { borderColor: 'border.muted', color: 'fg.default' },
      }}
    >
      <SearchIcon size={12} />
      <Box
        as="input"
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        sx={{
          flex: 1,
          minWidth: 0,
          border: 'none',
          outline: 'none',
          bg: 'transparent',
          color: 'fg.default',
          fontFamily: 'inherit',
          fontSize: isMd ? 1 : 0,
          '&::placeholder': { color: 'fg.subtle' },
        }}
      />
      {value && (
        <Box
          as="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          sx={{
            border: 'none',
            bg: 'transparent',
            color: 'fg.subtle',
            cursor: 'pointer',
            fontSize: '10px',
            lineHeight: 1,
            px: 0,
            display: 'inline-flex',
            alignItems: 'center',
            '&:hover': { color: 'fg.default' },
          }}
        >
          ✕
        </Box>
      )}
    </Box>
  );
}
