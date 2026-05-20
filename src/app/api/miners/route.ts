import { NextResponse } from 'next/server';
import { getReadDb } from '@/lib/db';
import type { Miner, MinersResponse } from '@/types/entities';

export const dynamic = 'force-dynamic';

const MINERS_URL = 'https://api.gittensor.io/miners';
const PRS_URL = 'https://api.gittensor.io/prs';
const TTL_MS = 5_000;
// Long TTL avoids bursting 120 per-miner upstream fetches.
const PER_MINER_TTL_MS = 300_000;
const PRS_TTL_MS = 30_000;
const DISCOVERY_ACTIVITY_TTL_MS = 60_000;
// Validator's "valid merged PR" threshold.
const VALID_TOKEN_SCORE = 5;

interface UpstreamRepository {
  repositoryFullName?: string;
  isEligible?: boolean;
  isIssueEligible?: boolean;
}

interface UpstreamPerMiner {
  repositories?: UpstreamRepository[];
}

interface UpstreamPr {
  pullRequestNumber: number;
  hotkey?: string | null;
  repository?: string;
  mergedAt?: string | null;
  prCreatedAt?: string | null;
  author?: string | null;
  githubId?: string | number | null;
  tokenScore?: string | number | null;
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

let prsCache: { fetched_at: number; prs: UpstreamPr[] } | null = null;
let prsInFlight: Promise<UpstreamPr[]> | null = null;

function asNum(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

async function fetchPrs(): Promise<UpstreamPr[]> {
  const now = Date.now();
  if (prsCache && now - prsCache.fetched_at < PRS_TTL_MS) return prsCache.prs;
  if (prsInFlight) return prsInFlight;
  prsInFlight = (async () => {
    try {
      const r = await fetch(PRS_URL, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`upstream ${r.status}`);
      const prs = (await r.json()) as UpstreamPr[];
      prsCache = { fetched_at: Date.now(), prs };
      return prs;
    } catch {
      return prsCache?.prs ?? [];
    } finally {
      prsInFlight = null;
    }
  })();
  return prsInFlight;
}

// Identifier→count for merged PRs with tokenScore >= VALID_TOKEN_SCORE.
// Indexed by every identifier since historical PRs sometimes omit one.
function indexValidMergedPrs(prs: UpstreamPr[]): {
  byGhId: Map<string, number>;
  byLoginLc: Map<string, number>;
  byHotkey: Map<string, number>;
} {
  const byGhId = new Map<string, number>();
  const byLoginLc = new Map<string, number>();
  const byHotkey = new Map<string, number>();
  for (const pr of prs) {
    if (!pr.mergedAt) continue;
    if (asNum(pr.tokenScore ?? 0) < VALID_TOKEN_SCORE) continue;
    if (pr.githubId) {
      const k = String(pr.githubId);
      byGhId.set(k, (byGhId.get(k) ?? 0) + 1);
    }
    if (pr.author) {
      const k = pr.author.toLowerCase();
      byLoginLc.set(k, (byLoginLc.get(k) ?? 0) + 1);
    }
    if (pr.hotkey) {
      byHotkey.set(pr.hotkey, (byHotkey.get(pr.hotkey) ?? 0) + 1);
    }
  }
  return { byGhId, byLoginLc, byHotkey };
}

// Identifier→latest `mergedAt ?? prCreatedAt` per miner.
function indexLastPrActivity(prs: UpstreamPr[]): {
  byGhId: Map<string, string>;
  byLoginLc: Map<string, string>;
  byHotkey: Map<string, string>;
} {
  const byGhId = new Map<string, string>();
  const byLoginLc = new Map<string, string>();
  const byHotkey = new Map<string, string>();
  const update = (map: Map<string, string>, key: string, ts: string) => {
    const cur = map.get(key);
    if (!cur || ts > cur) map.set(key, ts);
  };
  for (const pr of prs) {
    const ts = pr.mergedAt || pr.prCreatedAt;
    if (!ts) continue;
    if (pr.githubId) update(byGhId, String(pr.githubId), ts);
    if (pr.author) update(byLoginLc, pr.author.toLowerCase(), ts);
    if (pr.hotkey) update(byHotkey, pr.hotkey, ts);
  }
  return { byGhId, byLoginLc, byHotkey };
}

// login → latest issue activity, from the local DB (poller-populated).
let discoveryActivityCache: { fetched_at: number; byLoginLc: Map<string, string> } | null = null;
let discoveryActivityInFlight: Promise<Map<string, string>> | null = null;

async function fetchDiscoveryActivity(): Promise<Map<string, string>> {
  const now = Date.now();
  if (discoveryActivityCache && now - discoveryActivityCache.fetched_at < DISCOVERY_ACTIVITY_TTL_MS) {
    return discoveryActivityCache.byLoginLc;
  }
  if (discoveryActivityInFlight) return discoveryActivityInFlight;
  discoveryActivityInFlight = (async () => {
    try {
      const db = getReadDb();
      type Row = { login: string | null; last_active: string | null };
      const rows = db
        .prepare(
          `SELECT LOWER(author_login) AS login,
                  MAX(COALESCE(closed_at, updated_at, created_at)) AS last_active
             FROM issues
            WHERE author_login IS NOT NULL AND author_login != ''
            GROUP BY LOWER(author_login)`,
        )
        .all() as Row[];
      const map = new Map<string, string>();
      for (const r of rows) {
        if (r.login && r.last_active) map.set(r.login, r.last_active);
      }
      discoveryActivityCache = { fetched_at: Date.now(), byLoginLc: map };
      return map;
    } catch {
      return discoveryActivityCache?.byLoginLc ?? new Map();
    } finally {
      discoveryActivityInFlight = null;
    }
  })();
  return discoveryActivityInFlight;
}

// Eligibility = validator's per-repo flags (canonical). We don't
// re-derive client-side — needs per-PR token_scores.
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
  const [minersR, prs, discoveryActivity] = await Promise.all([
    fetch(MINERS_URL, { cache: 'no-store', signal: AbortSignal.timeout(10_000) }),
    fetchPrs(),
    fetchDiscoveryActivity(),
  ]);
  if (!minersR.ok) throw new Error(`upstream ${minersR.status}`);
  const upstreamMiners = (await minersR.json()) as Miner[];

  const validIdx = indexValidMergedPrs(prs);
  const lastPrIdx = indexLastPrActivity(prs);

  // Identifier fall-through: githubId → login → hotkey.
  const pickPrActivity = (m: Miner): string | null =>
    (m.githubId != null ? lastPrIdx.byGhId.get(String(m.githubId)) : undefined) ??
    (m.githubUsername ? lastPrIdx.byLoginLc.get(m.githubUsername.toLowerCase()) : undefined) ??
    (m.hotkey ? lastPrIdx.byHotkey.get(m.hotkey) : undefined) ??
    null;

  const enriched = await Promise.all(
    upstreamMiners.map(async (m) => {
      const validMerged =
        (m.githubId != null ? validIdx.byGhId.get(String(m.githubId)) : undefined) ??
        (m.githubUsername ? validIdx.byLoginLc.get(m.githubUsername.toLowerCase()) : undefined) ??
        (m.hotkey ? validIdx.byHotkey.get(m.hotkey) : undefined) ??
        0;
      const lastOssActivityAt = pickPrActivity(m);
      const lastDiscoveryActivityAt = m.githubUsername
        ? (discoveryActivity.get(m.githubUsername.toLowerCase()) ?? null)
        : null;
      const baseEnrich = {
        ...m,
        totalValidMergedPrs: validMerged,
        lastOssActivityAt,
        lastDiscoveryActivityAt,
      };
      if (!m.githubId) return baseEnrich;
      const counts = await fetchPerMinerCounts(String(m.githubId));
      return {
        ...baseEnrich,
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
