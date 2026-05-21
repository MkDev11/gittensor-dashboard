import { NextResponse } from 'next/server';
import { getDb, getReadDb } from '@/lib/db';
import type { Miner, MinerTopRepo, MinersResponse } from '@/types/entities';

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
// 14-day sparkline window matches the leaderboard row width budget.
const SPARKLINE_DAYS = 35;
const TOP_REPOS_PER_MINER = 5;
const DAY_MS = 86_400_000;

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
const perMinerInFlight = new Map<string, Promise<RepoCounts | null>>();

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
    } catch (err) {
      // Cold-start with no cache: propagate so refresh() doesn't zero out activity metrics.
      if (!prsCache) throw err;
      return prsCache.prs;
    } finally {
      prsInFlight = null;
    }
  })();
  return prsInFlight;
}

// Counts valid merged PRs per identifier; indexes all three since older PRs may omit some.
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

interface PrAggregateIndex {
  dailyById: Map<string, number[]>;
  dailyByLoginLc: Map<string, number[]>;
  dailyByHotkey: Map<string, number[]>;
  reposById: Map<string, MinerTopRepo[]>;
  reposByLoginLc: Map<string, MinerTopRepo[]>;
  reposByHotkey: Map<string, MinerTopRepo[]>;
}

// Single pass: sparkline counts + top repos. Window = last SPARKLINE_DAYS UTC days, index 0 = oldest.
function indexPrAggregates(prs: UpstreamPr[], now: Date): PrAggregateIndex {
  const dayStartMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const oldestMs = dayStartMs - (SPARKLINE_DAYS - 1) * DAY_MS;

  const dailyById = new Map<string, number[]>();
  const dailyByLoginLc = new Map<string, number[]>();
  const dailyByHotkey = new Map<string, number[]>();
  const repoCountsById = new Map<string, Map<string, number>>();
  const repoCountsByLoginLc = new Map<string, Map<string, number>>();
  const repoCountsByHotkey = new Map<string, Map<string, number>>();

  const bumpDaily = (map: Map<string, number[]>, key: string, bucket: number) => {
    let arr = map.get(key);
    if (!arr) {
      arr = new Array(SPARKLINE_DAYS).fill(0);
      map.set(key, arr);
    }
    arr[bucket] += 1;
  };
  const bumpRepo = (
    map: Map<string, Map<string, number>>,
    key: string,
    repo: string,
  ) => {
    let m = map.get(key);
    if (!m) {
      m = new Map<string, number>();
      map.set(key, m);
    }
    m.set(repo, (m.get(repo) ?? 0) + 1);
  };

  for (const pr of prs) {
    const ts = pr.mergedAt || pr.prCreatedAt;
    if (!ts) continue;
    const tsMs = Date.parse(ts);
    if (!Number.isFinite(tsMs)) continue;
    const bucket = Math.floor((tsMs - oldestMs) / DAY_MS);
    const inWindow = bucket >= 0 && bucket < SPARKLINE_DAYS;
    const repo = pr.repository ?? '';
    const ghId = pr.githubId != null ? String(pr.githubId) : '';
    const loginLc = pr.author ? pr.author.toLowerCase() : '';
    const hotkey = pr.hotkey ?? '';
    if (ghId) {
      if (inWindow) bumpDaily(dailyById, ghId, bucket);
      if (repo) bumpRepo(repoCountsById, ghId, repo);
    }
    if (loginLc) {
      if (inWindow) bumpDaily(dailyByLoginLc, loginLc, bucket);
      if (repo) bumpRepo(repoCountsByLoginLc, loginLc, repo);
    }
    if (hotkey) {
      if (inWindow) bumpDaily(dailyByHotkey, hotkey, bucket);
      if (repo) bumpRepo(repoCountsByHotkey, hotkey, repo);
    }
  }

  const finalizeRepos = (
    src: Map<string, Map<string, number>>,
  ): Map<string, MinerTopRepo[]> => {
    const out = new Map<string, MinerTopRepo[]>();
    for (const [key, counts] of src) {
      const list: MinerTopRepo[] = [];
      for (const [name, count] of counts) list.push({ name, count });
      list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      out.set(key, list.slice(0, TOP_REPOS_PER_MINER));
    }
    return out;
  };

  return {
    dailyById,
    dailyByLoginLc,
    dailyByHotkey,
    reposById: finalizeRepos(repoCountsById),
    reposByLoginLc: finalizeRepos(repoCountsByLoginLc),
    reposByHotkey: finalizeRepos(repoCountsByHotkey),
  };
}

// Today's snapshot captured on first refresh of each UTC day; yesterday's drives previousRank (~24h window). SQLite-backed so movement survives restarts.
interface RankSnapshot {
  date: string;
  ranksByUid: Map<number, number>;
}
let todayRankSnapshot: RankSnapshot | null = null;
let yesterdayRankSnapshot: RankSnapshot | null = null;
let snapshotHydrated = false;

function utcDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function computeRanks(miners: Miner[]): Map<number, number> {
  const sorted = [...miners].sort(
    (a, b) => asNum(b.totalScore) - asNum(a.totalScore),
  );
  const map = new Map<number, number>();
  sorted.forEach((m, i) => map.set(m.uid, i + 1));
  return map;
}

function ensureSnapshotTable(): void {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS miner_rank_snapshots (
    date       TEXT PRIMARY KEY,
    ranks_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
}

function loadSnapshotFromDb(date: string): RankSnapshot | null {
  try {
    const row = getReadDb()
      .prepare(`SELECT date, ranks_json FROM miner_rank_snapshots WHERE date = ?`)
      .get(date) as { date: string; ranks_json: string } | undefined;
    if (!row) return null;
    const entries = JSON.parse(row.ranks_json) as [number, number][];
    return { date: row.date, ranksByUid: new Map(entries) };
  } catch {
    return null;
  }
}

function loadMostRecentSnapshotBefore(date: string): RankSnapshot | null {
  try {
    const row = getReadDb()
      .prepare(
        `SELECT date, ranks_json FROM miner_rank_snapshots WHERE date < ? ORDER BY date DESC LIMIT 1`,
      )
      .get(date) as { date: string; ranks_json: string } | undefined;
    if (!row) return null;
    const entries = JSON.parse(row.ranks_json) as [number, number][];
    return { date: row.date, ranksByUid: new Map(entries) };
  } catch {
    return null;
  }
}

function persistSnapshot(snap: RankSnapshot): void {
  try {
    const db = getDb();
    const json = JSON.stringify(Array.from(snap.ranksByUid.entries()));
    db.prepare(
      `INSERT INTO miner_rank_snapshots (date, ranks_json, created_at) VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET ranks_json = excluded.ranks_json, created_at = excluded.created_at`,
    ).run(snap.date, json, new Date().toISOString());
    db.prepare(`DELETE FROM miner_rank_snapshots WHERE date < date(?, '-14 days')`).run(snap.date);
  } catch {
    // Persistence is best-effort; in-memory snapshots still drive the response.
  }
}

function hydrateSnapshots(today: string): void {
  if (snapshotHydrated) return;
  try {
    ensureSnapshotTable();
    todayRankSnapshot = loadSnapshotFromDb(today);
    yesterdayRankSnapshot = loadMostRecentSnapshotBefore(today);
  } catch {
    // ignore — operate from in-memory state only
  } finally {
    snapshotHydrated = true;
  }
}

function rollRankSnapshots(miners: Miner[], now: Date): RankSnapshot | null {
  const today = utcDateStr(now);
  hydrateSnapshots(today);
  if (!todayRankSnapshot || todayRankSnapshot.date !== today) {
    if (todayRankSnapshot) yesterdayRankSnapshot = todayRankSnapshot;
    todayRankSnapshot = { date: today, ranksByUid: computeRanks(miners) };
    persistSnapshot(todayRankSnapshot);
  }
  return yesterdayRankSnapshot;
}

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

// Eligibility from validator's per-repo flags (canonical); can't re-derive without per-PR token scores.
// Returns null on cold-start failure so the caller keeps prior eligibility instead of flipping to false.
async function fetchPerMinerCounts(githubId: string): Promise<RepoCounts | null> {
  const now = Date.now();
  const hit = perMinerCache.get(githubId);
  if (hit && now - hit.fetched_at < PER_MINER_TTL_MS) return hit.counts;

  const inflight = perMinerInFlight.get(githubId);
  if (inflight) return inflight;

  const p = (async (): Promise<RepoCounts | null> => {
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
      return hit?.counts ?? null;
    } finally {
      perMinerInFlight.delete(githubId);
    }
  })();
  perMinerInFlight.set(githubId, p);
  return p;
}

// Bounds concurrency for cold-cache fan-out (~120 per-miner fetches) to avoid upstream rate-limit/timeout.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

const PER_MINER_CONCURRENCY = 8;

async function refresh(): Promise<Cached> {
  const [minersR, prs, discoveryActivity] = await Promise.all([
    fetch(MINERS_URL, { cache: 'no-store', signal: AbortSignal.timeout(10_000) }),
    fetchPrs(),
    fetchDiscoveryActivity(),
  ]);
  if (!minersR.ok) throw new Error(`upstream ${minersR.status}`);
  const upstreamMiners = (await minersR.json()) as Miner[];

  const now = new Date();
  const validIdx = indexValidMergedPrs(prs);
  const lastPrIdx = indexLastPrActivity(prs);
  const prAggregates = indexPrAggregates(prs, now);

  // Identifier fall-through: githubId → login → hotkey.
  const pickPrActivity = (m: Miner): string | null =>
    (m.githubId != null ? lastPrIdx.byGhId.get(String(m.githubId)) : undefined) ??
    (m.githubUsername ? lastPrIdx.byLoginLc.get(m.githubUsername.toLowerCase()) : undefined) ??
    (m.hotkey ? lastPrIdx.byHotkey.get(m.hotkey) : undefined) ??
    null;

  const pickDaily35 = (m: Miner): number[] => {
    const found =
      (m.githubId != null ? prAggregates.dailyById.get(String(m.githubId)) : undefined) ??
      (m.githubUsername ? prAggregates.dailyByLoginLc.get(m.githubUsername.toLowerCase()) : undefined) ??
      (m.hotkey ? prAggregates.dailyByHotkey.get(m.hotkey) : undefined);
    return found ?? new Array(SPARKLINE_DAYS).fill(0);
  };

  const pickTopRepos = (m: Miner): MinerTopRepo[] =>
    (m.githubId != null ? prAggregates.reposById.get(String(m.githubId)) : undefined) ??
    (m.githubUsername ? prAggregates.reposByLoginLc.get(m.githubUsername.toLowerCase()) : undefined) ??
    (m.hotkey ? prAggregates.reposByHotkey.get(m.hotkey) : undefined) ??
    [];

  const enriched = await mapWithConcurrency(upstreamMiners, PER_MINER_CONCURRENCY, async (m) => {
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
      daily35: pickDaily35(m),
      topRepos: pickTopRepos(m),
    };
    if (!m.githubId) return baseEnrich;
    const counts = await fetchPerMinerCounts(String(m.githubId));
    if (counts == null) return baseEnrich;
    return {
      ...baseEnrich,
      eligibleRepoCount: counts.oss,
      issueEligibleRepoCount: counts.disc,
      isEligible: counts.oss > 0,
      isIssueEligible: counts.disc > 0,
    };
  });

  // Must run after eligibility enrichment so movement reflects the score clients see.
  const previousRanks = rollRankSnapshots(enriched, now);
  const withPreviousRank: Miner[] = enriched.map((m) => ({
    ...m,
    previousRank: previousRanks?.ranksByUid.get(m.uid) ?? null,
  }));

  const next: Cached = { fetched_at: Date.now(), miners: withPreviousRank };
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
