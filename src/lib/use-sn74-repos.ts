'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ALL_REPOS, type RepoEntry } from '@/lib/repos';

interface Sn74ReposResp {
  repos: RepoEntry[];
  source: 'live' | 'empty';
  fetched_at: string | null;
  count: number;
}

/**
 * Live SN74 master list mirror keyed for client-side use. Both the standalone
 * /pulls and /issues pages need a `repo_full_name → weight` lookup for
 * sorting and per-row score display; the bundled `ALL_REPOS` import goes
 * stale the moment upstream master_repositories.json is edited (e.g. the
 * newly added `entrius/das-github-mirror` wasn't in the build snapshot).
 *
 * Server polls master_repositories.json every 5 min and persists any new
 * repos at weight 0; nothing is ever removed. Client refetches on the same
 * cadence so newly discovered repos appear without a page reload.
 */
export function useSn74Repos(): {
  repos: RepoEntry[];
  weights: Map<string, number>;
  isSuccess: boolean;
} {
  const { data, isSuccess } = useQuery<Sn74ReposResp>({
    queryKey: ['sn74-repos'],
    queryFn: async ({ signal }) => {
      const r = await fetch('/api/sn74-repos', { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const repos = data?.repos ?? ALL_REPOS;

  // Lower-cased key so callers can pass any casing variant without surprises.
  const weights = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of repos) m.set(r.fullName.toLowerCase(), r.weight);
    return m;
  }, [repos]);

  return { repos, weights, isSuccess };
}

/** Look up a single repo's weight from a Map produced by `useSn74Repos`.
 *  Returns `undefined` for non-SN74 repos so callers can distinguish them
 *  from on-list repos with explicit weight 0 if needed. */
export function lookupWeight(weights: Map<string, number>, fullName: string): number | undefined {
  return weights.get(fullName.toLowerCase());
}
