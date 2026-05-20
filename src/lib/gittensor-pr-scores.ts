import type { PullScore } from '@/types/entities';

const GITTENSOR_PRS_URL = 'https://api.gittensor.io/prs';
export const GITTENSOR_PR_SCORE_TTL_MS = 30_000;

interface UpstreamGittensorPr {
  repository: string;
  pullRequestNumber: number;
  score?: string | number | null;
  potentialScore?: string | number | null;
  collateralScore?: string | number | null;
  collateral_score?: string | number | null;
  prState?: string | null;
  mergedAt?: string | null;
}

interface CachedGittensorScores {
  fetched_at: number;
  byPull: Map<string, PullScore>;
}

let scoreCache: CachedGittensorScores | null = null;
let scoreInFlight: Promise<CachedGittensorScores> | null = null;

export function pullScoreKey(repoFullName: string, prNumber: number): string {
  return `${repoFullName.toLowerCase()}#${prNumber}`;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

async function refreshGittensorScores(): Promise<CachedGittensorScores> {
  const r = await fetch(GITTENSOR_PRS_URL, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const raw = (await r.json()) as UpstreamGittensorPr[];
  const byPull = new Map<string, PullScore>();
  for (const pr of raw) {
    const number = Number(pr.pullRequestNumber);
    if (!pr.repository || !Number.isFinite(number)) continue;
    const merged = pr.prState?.toUpperCase() === 'MERGED' || !!pr.mergedAt;
    const finalScore = nullableNumber(pr.score);
    const potentialScore = nullableNumber(pr.potentialScore);
    byPull.set(pullScoreKey(pr.repository, number), {
      score: merged ? finalScore ?? potentialScore : potentialScore ?? finalScore,
      collateral_score: nullableNumber(pr.collateralScore ?? pr.collateral_score),
    });
  }
  const next = { fetched_at: Date.now(), byPull };
  scoreCache = next;
  return next;
}

export async function getGittensorPrScoreMap(): Promise<Map<string, PullScore> | null> {
  const now = Date.now();
  if (scoreCache && now - scoreCache.fetched_at < GITTENSOR_PR_SCORE_TTL_MS) return scoreCache.byPull;
  if (!scoreInFlight) {
    scoreInFlight = refreshGittensorScores().finally(() => {
      scoreInFlight = null;
    });
  }
  try {
    const scores = await scoreInFlight;
    return scores.byPull;
  } catch {
    return scoreCache?.byPull ?? null;
  }
}
