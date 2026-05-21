export function weightColor(w: number): string {
  if (w >= 0.5) return 'var(--success-fg)';
  if (w >= 0.3) return 'var(--accent-fg)';
  if (w >= 0.15) return 'var(--attention-emphasis)';
  if (w >= 0.05) return 'var(--fg-default)';
  return 'var(--fg-subtle)';
}

export function weightFontWeight(w: number): number {
  if (w >= 0.5) return 700;
  if (w >= 0.3) return 700;
  if (w >= 0.15) return 600;
  if (w >= 0.05) return 500;
  return 400;
}
