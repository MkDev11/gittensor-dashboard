import type { Sn74Repo } from '@/types/entities';

export type { Sn74Repo };

/**
 * Empty by design — the bundled `master_repositories.json` is no longer
 * consulted. Live data flows from `/api/sn74-repos` (server-side) into
 * client components via `useSn74Repos()`. Anything that imported this for
 * a synchronous initial value now just gets an empty list until the live
 * fetch lands; render an empty/loading state accordingly.
 */
export const ALL_REPOS: Sn74Repo[] = [];

export function weightBand(weight: number): {
  label: string;
  tone: 'success' | 'accent' | 'attention' | 'severe' | 'neutral';
} {
  if (weight >= 0.5) return { label: 'Flagship', tone: 'success' };
  if (weight >= 0.3) return { label: 'High', tone: 'accent' };
  if (weight >= 0.15) return { label: 'Mid-High', tone: 'attention' };
  if (weight >= 0.05) return { label: 'Standard', tone: 'neutral' };
  return { label: 'Low', tone: 'severe' };
}
