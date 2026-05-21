// Pure parsers for the `https://api.gittensor.io/dash/repos` payload.
// Centralised here so the two GT route handlers share a single source of
// truth and the parsing can be unit-tested without spinning up Next.js.
//
// Upstream has evolved across snapshots. We accept both snake_case and
// camelCase variants for every field, at both the `config.*` and top
// level — that way an upstream rename does not silently zero out the
// repo weight or flip an ineligible repo back to active.

export interface UpstreamRepoConfigLike {
  weight?: string | number;
  emission_share?: string | number;
  emissionShare?: string | number;
  inactiveAt?: string | null;
  inactive_at?: string | null;
  eligibility_mode?: boolean;
  eligibilityMode?: boolean;
}

export interface UpstreamRepoLike {
  config?: UpstreamRepoConfigLike | null;
  weight?: string | number;
  emission_share?: string | number;
  emissionShare?: string | number;
  inactiveAt?: string | null;
  inactive_at?: string | null;
  eligibility_mode?: boolean;
  eligibilityMode?: boolean;
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

export function repoWeight(repo: UpstreamRepoLike): number {
  return num(
    repo.config?.emission_share ??
      repo.config?.emissionShare ??
      repo.config?.weight ??
      repo.emission_share ??
      repo.emissionShare ??
      repo.weight,
  );
}

export function repoInactiveAt(repo: UpstreamRepoLike): string | null {
  const inactiveAt =
    repo.config?.inactive_at ??
    repo.config?.inactiveAt ??
    repo.inactive_at ??
    repo.inactiveAt ??
    null;
  const ineligible =
    repo.config?.eligibility_mode === false ||
    repo.config?.eligibilityMode === false ||
    repo.eligibility_mode === false ||
    repo.eligibilityMode === false;
  if (ineligible) return inactiveAt ?? 'ineligible';
  return inactiveAt;
}
