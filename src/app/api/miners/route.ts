import { NextResponse } from 'next/server';
import type { Miner, MinersResponse } from '@/types/entities';

export const dynamic = 'force-dynamic';

const MINERS_URL = 'https://api.gittensor.io/miners';
const TTL_MS = 5_000;
// Per-miner data changes slowly; long TTL avoids bursting 120 fetches.
const PER_MINER_TTL_MS = 300_000;

interface UpstreamRepository {
  repositoryFullName?: string;
  isEligible?: boolean;
  isIssueEligible?: boolean;
}

interface UpstreamPerMiner {
  repositories?: UpstreamRepository[];
}

interface RepoCounts {
  oss: number;
  disc: number;
}

interface PerMinerCacheEntry {
  fetched_at: number;
  counts: RepoCounts;
}

interface Cached {
  fetched_at: number;
  miners: Miner[];
}

let cache: Cached | null = null;
let inFlight: Promise<Cached> | null = null;

const perMinerCache = new Map<string, PerMinerCacheEntry>();
const perMinerInFlight = new Map<string, Promise<RepoCounts>>();

// Eligibility = validator's per-repo flags. Source of truth lives in the
// gittensor validator (constants.py: 3 valid PRs/issues, 80% credibility,
// token_score gate). We don't re-derive client-side — it can't be done
// accurately without per-PR token_scores.
async function fetchPerMinerCounts(githubId: string): Promise<RepoCounts> {
  const now = Date.now();
  const hit = perMinerCache.get(githubId);
  if (hit && now - hit.fetched_at < PER_MINER_TTL_MS) return hit.counts;

  const inflight = perMinerInFlight.get(githubId);
  if (inflight) return inflight;

  const p = (async (): Promise<RepoCounts> => {
    try {
      const r = await fetch(`${MINERS_URL}/${githubId}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) throw new Error(`upstream ${r.status}`);
      const data = (await r.json()) as UpstreamPerMiner;
      let oss = 0, disc = 0;
      for (const repo of data.repositories ?? []) {
        if (!repo.repositoryFullName) continue;
        if (repo.isEligible === true) oss += 1;
        if (repo.isIssueEligible === true) disc += 1;
      }
      const counts: RepoCounts = { oss, disc };
      perMinerCache.set(githubId, { fetched_at: Date.now(), counts });
      return counts;
    } catch {
      return hit?.counts ?? { oss: 0, disc: 0 };
    } finally {
      perMinerInFlight.delete(githubId);
    }
  })();
  perMinerInFlight.set(githubId, p);
  return p;
}

async function refresh(): Promise<Cached> {
  const r = await fetch(MINERS_URL, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const upstreamMiners = (await r.json()) as Miner[];

  // Enrich each miner's per-track repo counts + derive miner-level
  // eligibility from those counts (no more "eligible miner, 0 repos").
  const enriched = await Promise.all(
    upstreamMiners.map(async (m) => {
      if (!m.githubId) return m;
      const counts = await fetchPerMinerCounts(String(m.githubId));
      return {
        ...m,
        eligibleRepoCount: counts.oss,
        issueEligibleRepoCount: counts.disc,
        isEligible: counts.oss > 0,
        isIssueEligible: counts.disc > 0,
      };
    }),
  );

  const next: Cached = { fetched_at: Date.now(), miners: enriched };
  cache = next;
  return next;
}

function payload(c: Cached, source: 'live' | 'cache' | 'stale', error?: string): MinersResponse & { error?: string } {
  return {
    count: c.miners.length,
    fetched_at: c.fetched_at,
    source,
    miners: c.miners,
    ...(error ? { error } : {}),
  };
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.fetched_at < TTL_MS) {
    return NextResponse.json(payload(cache, 'cache'));
  }
  if (!inFlight) {
    inFlight = refresh().finally(() => {
      inFlight = null;
    });
  }
  try {
    const fresh = await inFlight;
    return NextResponse.json(payload(fresh, 'live'));
  } catch (err) {
    if (cache) {
      return NextResponse.json(payload(cache, 'stale', String(err)));
    }
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
