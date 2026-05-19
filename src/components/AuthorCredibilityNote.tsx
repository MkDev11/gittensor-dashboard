'use client';

import type { AuthorCredibility } from '@/types/entities';

function percent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return `${Math.round(value * 100)}%`;
}

function tone(value: number | null): string {
  if (value === null) return 'var(--neutral-emphasis)';
  if (value >= 0.8) return 'var(--success-emphasis)';
  if (value >= 0.5) return '#d4a72c';
  return 'var(--danger-emphasis)';
}

export default function AuthorCredibilityNote({
  credibility,
  variant,
}: {
  credibility: AuthorCredibility | null | undefined;
  variant: 'issues' | 'pulls';
}) {
  if (!credibility) return null;

  const value = variant === 'issues'
    ? credibility.issue_credibility ?? credibility.credibility
    : credibility.credibility ?? credibility.issue_credibility;
  if (value === null) return null;
  const color = tone(value);

  return (
    <span
      title={`PR credibility ${percent(credibility.credibility)} · Issue credibility ${percent(credibility.issue_credibility)}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 18,
        minWidth: 34,
        padding: '0 5px',
        border: '1px solid',
        borderColor: color,
        borderRadius: '999px',
        background: 'transparent',
        color,
        fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, monospace',
        fontVariantNumeric: 'tabular-nums',
        fontSize: '10px',
        fontWeight: 700,
        lineHeight: '18px',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {percent(value)}
    </span>
  );
}
