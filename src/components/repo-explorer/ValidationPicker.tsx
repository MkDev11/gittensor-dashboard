import React from 'react';
import { Box } from '@primer/react';
import { CheckIcon, XIcon } from '@primer/octicons-react';

// Per-row valid / invalid picker. Two side-by-side toggle buttons — one for
// each state — so a single click sets or clears it. Mutually exclusive: clicking
// the opposite side of an already-set value flips directly to the new value.
export function ValidationPicker({
  value,
  onChange,
}: {
  value: 'valid' | 'invalid' | null;
  onChange: (next: 'valid' | 'invalid' | null) => void;
}) {
  const cellSx: React.CSSProperties = {
    width: 30,
    height: 24,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid var(--border-default)',
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1,
    transition: 'background 0.08s ease, color 0.08s ease',
  };
  return (
    <Box sx={{ display: 'inline-flex' }}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onChange(value === 'valid' ? null : 'valid');
        }}
        title={value === 'valid' ? 'Clear valid' : 'Mark as valid'}
        style={{
          ...cellSx,
          borderTopLeftRadius: 6,
          borderBottomLeftRadius: 6,
          borderRight: 'none',
          background: value === 'valid' ? 'var(--success-subtle)' : 'var(--bg-emphasis)',
          color: value === 'valid' ? 'var(--success-fg)' : 'var(--fg-muted)',
        }}
      >
        <CheckIcon size={14} />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onChange(value === 'invalid' ? null : 'invalid');
        }}
        title={value === 'invalid' ? 'Clear invalid' : 'Mark as invalid'}
        style={{
          ...cellSx,
          borderTopRightRadius: 6,
          borderBottomRightRadius: 6,
          background: value === 'invalid' ? 'var(--danger-subtle)' : 'var(--bg-emphasis)',
          color: value === 'invalid' ? 'var(--danger-fg)' : 'var(--fg-muted)',
        }}
      >
        <XIcon size={14} />
      </button>
    </Box>
  );
}
