'use client';

import React from 'react';
import { Box } from '@primer/react';

type IssueLabel = { name: string; color?: string | null };

const FALLBACK_COLORS: Array<[RegExp, string]> = [
  [/\bbug\b/, 'd73a4a'],
  [/\b(feature|feat)\b/, '2da44e'],
  [/\benhancement\b/, 'a2eeef'],
  [/\b(documentation|docs?)\b/, '0075ca'],
  [/\bsecurity\b/, 'd1242f'],
  [/\b(good first issue|starter)\b/, '7057ff'],
  [/\bhelp wanted\b/, '008672'],
  [/\bquestion\b/, 'd876e3'],
  [/\b(duplicate|invalid|wontfix|not planned)\b/, '6e7781'],
];

function normalizeHexColor(color: string | null | undefined): string | null {
  const raw = color?.trim().replace(/^#/, '');
  if (!raw) return null;
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return raw
      .split('')
      .map((c) => c + c)
      .join('')
      .toLowerCase();
  }
  return null;
}

function fallbackColorFor(name: string): string {
  const normalized = name.trim().toLowerCase();
  const match = FALLBACK_COLORS.find(([pattern]) => pattern.test(normalized));
  return match?.[1] ?? '6e7781';
}

// GitHub stores label colors as hex without `#`. Pick readable text with a
// YIQ-style luminance check so custom label colors stay legible.
function readableFgFor(hex: string): string {
  const h = normalizeHexColor(hex);
  if (!h) return '#ffffff';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 160 ? '#1f2328' : '#ffffff';
}

export const IssueLabelChip = React.memo(function IssueLabelChip({
  label,
  maxWidth = 120,
}: {
  label: IssueLabel;
  maxWidth?: number;
}) {
  const hex = normalizeHexColor(label.color) ?? fallbackColorFor(label.name);
  const bg = `#${hex}`;
  const fg = readableFgFor(hex);

  return (
    <span
      title={label.name}
      style={{
        display: 'inline-block',
        padding: '0 7px',
        borderRadius: 999,
        background: bg,
        color: fg,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: '18px',
        whiteSpace: 'nowrap',
        maxWidth,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        verticalAlign: 'middle',
      }}
    >
      {label.name}
    </span>
  );
});

export const IssueLabels = React.memo(function IssueLabels({
  labels,
  maxVisible = 4,
  maxLabelWidth = 120,
  wrap = false,
}: {
  labels: IssueLabel[] | null | undefined;
  maxVisible?: number;
  maxLabelWidth?: number;
  wrap?: boolean;
}) {
  if (!labels || labels.length === 0) return null;

  const visible = labels.slice(0, maxVisible);
  const hidden = labels.length - visible.length;

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        flexShrink: 0,
        flexWrap: wrap ? 'wrap' : 'nowrap',
        overflow: wrap ? 'visible' : 'hidden',
        maxWidth: '100%',
      }}
    >
      {visible.map((label) => (
        <IssueLabelChip key={label.name} label={label} maxWidth={maxLabelWidth} />
      ))}
      {hidden > 0 && (
        <span
          title={labels.slice(maxVisible).map((label) => label.name).join(', ')}
          style={{
            color: 'var(--fg-muted)',
            fontSize: 11,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          +{hidden}
        </span>
      )}
    </Box>
  );
});
