import type { Tone } from './types';

// Primer sx fragments — spread into any Box/Text.
export const MONO = {
  fontFamily: 'mono',
  fontVariantNumeric: 'tabular-nums',
} as const;

export const LABEL = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.6px',
  textTransform: 'uppercase',
  color: 'fg.muted',
} as const;

// CSS vars per tone — used via inline style, not sx (Primer can't resolve CSS vars in sx).
export const TONE_FG: Record<Tone, string> = {
  neutral: 'var(--fg-default)',
  success: 'var(--success-fg)',
  danger:  'var(--danger-fg)',
  done:    'var(--done-fg)',
  accent:  'var(--accent-fg)',
};
