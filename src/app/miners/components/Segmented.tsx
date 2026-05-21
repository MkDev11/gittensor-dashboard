'use client';

import React from 'react';
import { Box, Text } from '@primer/react';
import { MONO } from './tokens';

export interface SegmentOption<K extends string> {
  key: K;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

// Generic segmented control — multi-option toggle with optional per-segment
// icon + count chip.
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegmentOption<K>[];
  value: K;
  onChange: (k: K) => void;
  ariaLabel?: string;
}) {
  return (
    <Box
      role="group"
      aria-label={ariaLabel}
      sx={{
        display: 'inline-flex',
        alignItems: 'stretch',
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'border.default',
        bg: 'canvas.inset',
        p: '3px',
      }}
    >
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <Box
            as="button"
            key={opt.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.key)}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
              px: '10px',
              py: '4px',
              border: 'none',
              borderRadius: 1,
              bg: active ? 'canvas.default' : 'transparent',
              color: active ? 'fg.default' : 'fg.muted',
              fontFamily: 'inherit',
              fontSize: 0,
              fontWeight: active ? 700 : 500,
              cursor: 'pointer',
              boxShadow: active ? '0 0 0 1px var(--border-default)' : 'none',
              transition: 'background-color 100ms, color 100ms',
              '&:focus': { outline: 'none' },
              '&:focus-visible': { outline: '1px solid var(--fg-default)', outlineOffset: '2px', borderRadius: '4px' },
              '&:hover': { color: 'fg.default' },
              whiteSpace: 'nowrap',
            }}
          >
            {opt.icon}
            {opt.label}
            {typeof opt.count === 'number' && (
              <Text
                sx={{
                  ...MONO,
                  fontSize: '10px',
                  fontWeight: 700,
                  color: active ? 'fg.muted' : 'fg.subtle',
                  px: '5px',
                  py: '1px',
                  borderRadius: 999,
                  bg: 'canvas.inset',
                }}
              >
                {opt.count.toLocaleString()}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
