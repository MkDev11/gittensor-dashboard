import { NextResponse } from 'next/server';
import type { GtRepo, GtPrSummary, GtReposResponse } from '@/types/entities';
import { getReadDb } from '@/lib/db';
import { getLiveReposAsyncServer } from '@/lib/repos-server';
import { withRotation } from '@/lib/github';

export const dynamic = 'force-dynamic';

const REPOS_URL = 'https://api.gittensor.io/dash/repos';
const PRS_URL = 'https://api.gittensor.io/prs';
const TTL_MS = 30_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SERIES_DAYS = 14;

interface UpstreamRepoConfig {
  // Upstream renamed `weight` → `emissionShare`. Keep both for back-compat
  // with mirrors / older snapshots; prefer emissionShare when present.
  emissionShare?: string | number;
  weight?: string | number;
  emission_share?: string | number;
  maintainerCut?: string | number;
  issueDiscoveryShare?: string | number;
  trustedLabelPipeline?: boolean;
  labelMultipliers?: Record<string, number> | null;
  inactiveAt?: string | null;
  inactive_at?: string | null;
  eligibility_mode?: boolean;
}

interface UpstreamRepo {
  fullName: string;
  name: string;
  owner: string;
  // Upstream nests weight + inactiveAt under `config`. Older snapshots had
  // them at the top level, so we accept either shape and prefer config when
  // both are present.
  config?: UpstreamRepoConfig | null;
  weight?: string | number;
  emission_share?: string | number;
  emissionShare?: string | number;
  inactiveAt?: string | null;
  inactive_at?: string | null;
  eligibility_mode?: boolean;
}

interface UpstreamPr {
  pullRequestNumber: number;
  pullRequestTitle: string;
  repository: string;
  author: string | null;
  githubId?: string | null;
  prCreatedAt: string;
  mergedAt: string | null;
  prState: string;
  score?: string | number | null;
  collateralScore?: string | number | null;
  additions?: number | null;
  deletions?: number | null;
  commitCount?: number | null;
}

interface Cached {
  fetched_at: number;
  repos: GtRepo[];
  recentPrs: GtPrSummary[];
  prs: GtPrSummary[];
  totalEmissionWeight: number;
  prsMergedThisWeek: number;
  prsMergedLastWeek: number;
  uniqueContributors7d: number;
  uniqueContributorsPriorWeek: number;
  scoreEarnedThisWeek: number;
  scoreEarnedPriorWeek: number;
  stakedRepoCount: number;
  top5WeightConcentration: number;
  prsMergedSeries14d: number[];
  scoreEarnedSeries14d: number[];
  newContributors7d: number;
  returningContributors7d: number;
  medianMergeLatencyHours7d: number;
  medianMergeLatencyHoursPriorWeek: number;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

let cache: Cached | null = null;
let inFlight: Promise<Cached> | null = null;

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

function nullableNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

function repoWeight(repo: UpstreamRepo): number {
  return num(repo.config?.emission_share ?? repo.config?.emissionShare ?? repo.config?.weight ?? repo.emission_share ?? repo.emissionShare ?? repo.weight);
}

function repoInactiveAt(repo: UpstreamRepo): string | null {
  const inactiveAt = repo.config?.inactive_at ?? repo.config?.inactiveAt ?? repo.inactive_at ?? repo.inactiveAt ?? null;
  if (repo.config?.eligibility_mode === false || repo.eligibility_mode === false) return inactiveAt ?? 'ineligible';
  return inactiveAt;
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`upstream ${url} ${r.status}`);
  return (await r.json()) as T;
}

interface CountRow {
  repo: string;
  cnt: number;
}

function countOpenByRepo(table: 'pulls' | 'issues'): Map<string, number> {
  // Local DB may be empty (e.g. tests, fresh checkout) — swallow and return
  // empty so the route degrades to zero counts rather than 500ing.
  try {
    const sql =
      table === 'pulls'
        ? `SELECT repo_full_name as repo, COUNT(*) as cnt
           FROM pulls WHERE state = 'open' AND draft = 0
           GROUP BY repo_full_name`
        : `SELECT repo_full_name as repo, COUNT(*) as cnt
           FROM issues WHERE state = 'open'
           GROUP BY repo_full_name`;
    const rows = getReadDb().prepare(sql).all() as CountRow[];
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.repo.toLowerCase(), r.cnt);
    return m;
  } catch {
    return new Map();
  }
}

// Stars change slowly; refreshing per-30s cache cycle would burn budget for
// no real-time value. Keep an in-memory mirror with a longer TTL and refresh
// it opportunistically alongside the main cache.
const STARS_TTL_MS = 30 * 60 * 1000;
const starsByRepo = new Map<string, { stars: number | null; fetched_at: number }>();
let starsRefreshInFlight: Promise<void> | null = null;

async function fetchStars(owner: string, name: string): Promise<number | null> {
  try {
    const r = await withRotation((octokit) =>
      octokit.rest.repos.get({ owner, repo: name }),
    );
    return r.data.stargazers_count ?? null;
  } catch {
    return null;
  }
}

function refreshStarsIfStale(repos: Array<{ owner: string; name: string; fullName: string }>): Promise<void> {
  if (starsRefreshInFlight) return starsRefreshInFlight;
  const now = Date.now();
  const stale = repos.filter((r) => {
    const e = starsByRepo.get(r.fullName.toLowerCase());
    return !e || now - e.fetched_at > STARS_TTL_MS;
  });
  if (stale.length === 0) return Promise.resolve();
  starsRefreshInFlight = (async () => {
    try {
      await Promise.all(
        stale.map(async (r) => {
          const stars = await fetchStars(r.owner, r.name);
          starsByRepo.set(r.fullName.toLowerCase(), { stars, fetched_at: Date.now() });
        }),
      );
    } finally {
      starsRefreshInFlight = null;
    }
  })();
  return starsRefreshInFlight;
}

function lastPrAtByRepo(): Map<string, number> {
  // Must be merged_at, not created_at: a repo full of old open PRs would
  // otherwise look fresh and never trigger the stale flag.
  try {
    const rows = getReadDb()
      .prepare(
        `SELECT repo_full_name as repo, MAX(merged_at) as ts
         FROM pulls WHERE merged_at IS NOT NULL
         GROUP BY repo_full_name`,
      )
      .all() as Array<{ repo: string; ts: string | null }>;
    const m = new Map<string, number>();
    for (const r of rows) {
      if (!r.ts) continue;
      const t = Date.parse(r.ts);
      if (Number.isFinite(t)) m.set(r.repo.toLowerCase(), t);
    }
    return m;
  } catch {
    return new Map();
  }
}

async function refresh(): Promise<Cached> {
  const [reposRaw, prsRaw, sn74] = await Promise.all([
    fetchJson<UpstreamRepo[]>(REPOS_URL),
    fetchJson<UpstreamPr[]>(PRS_URL),
    getLiveReposAsyncServer(),
  ]);
  const openPrByRepo = countOpenByRepo('pulls');
  const openIssueByRepo = countOpenByRepo('issues');
  const dbLastPrByRepo = lastPrAtByRepo();
  const sn74ByRepo = new Map<string, (typeof sn74.repos)[number]>();
  for (const r of sn74.repos) sn74ByRepo.set(r.fullName.toLowerCase(), r);

  // Kick off stars refresh alongside the rest of the cache; don't block the
  // 30s cycle on it. Returns whatever's already cached this pass.
  void refreshStarsIfStale(reposRaw.map((r) => ({ owner: r.owner, name: r.name, fullName: r.fullName })));

  const now = Date.now();
  const weekAgo = now - WEEK_MS;
  const twoWeeksAgo = now - 2 * WEEK_MS;

  interface Agg {
    totalScore: number;
    totalPrCount: number;
    mergedPrCount: number;
    collateralStaked: number;
    prsThisWeek: number;
    prsLastWeek: number;
    contributors: Set<string>;
    lastPrAt: number;
  }
  const aggMap = new Map<string, Agg>();
  const ensure = (k: string): Agg => {
    const key = k.toLowerCase();
    let a = aggMap.get(key);
    if (!a) {
      a = {
        totalScore: 0,
        totalPrCount: 0,
        mergedPrCount: 0,
        collateralStaked: 0,
        prsThisWeek: 0,
        prsLastWeek: 0,
        contributors: new Set<string>(),
        lastPrAt: 0,
      };
      aggMap.set(key, a);
    }
    return a;
  };

  let prsMergedThisWeek = 0;
  let prsMergedLastWeek = 0;
  let scoreEarnedThisWeek = 0;
  let scoreEarnedPriorWeek = 0;
  const contributors7d = new Set<string>();
  const contributorsPriorWeek = new Set<string>();
  // Earliest-ever merged timestamp per author. Drives new vs returning
  // contributor classification at the end of the loop.
  const firstMergeByAuthor = new Map<string, number>();
  const latency7d: number[] = [];
  const latencyPriorWeek: number[] = [];

  // 14-day daily merged-PR series, indexed by repo (lowercased). Buckets are
  // UTC days. seriesStart is the start of (today - 13) UTC, so seriesStart +
  // SERIES_DAYS * DAY_MS covers up to and including today.
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const seriesStart = todayStart - (SERIES_DAYS - 1) * DAY_MS;
  const seriesByRepo = new Map<string, number[]>();
  const ensureSeries = (k: string): number[] => {
    let s = seriesByRepo.get(k);
    if (!s) {
      s = new Array<number>(SERIES_DAYS).fill(0);
      seriesByRepo.set(k, s);
    }
    return s;
  };
  const prsMergedSeries14d = new Array<number>(SERIES_DAYS).fill(0);
  const scoreEarnedSeries14d = new Array<number>(SERIES_DAYS).fill(0);

  for (const p of prsRaw) {
    const a = ensure(p.repository);
    a.totalScore += num(p.score);
    a.collateralStaked += num(p.collateralScore);
    a.totalPrCount += 1;
    const author = p.author || p.githubId;
    if (p.mergedAt) {
      a.mergedPrCount += 1;
      if (author) a.contributors.add(author);
      const mt = Date.parse(p.mergedAt);
      const prScore = num(p.score);
      if (author) {
        const earliest = firstMergeByAuthor.get(author);
        if (earliest === undefined || mt < earliest) firstMergeByAuthor.set(author, mt);
      }
      if (mt >= weekAgo) {
        prsMergedThisWeek += 1;
        scoreEarnedThisWeek += prScore;
        if (author) contributors7d.add(author);
      } else if (mt >= twoWeeksAgo) {
        prsMergedLastWeek += 1;
        scoreEarnedPriorWeek += prScore;
        if (author) contributorsPriorWeek.add(author);
      }
      if (mt >= seriesStart && mt < todayStart + DAY_MS) {
        const idx = Math.floor((mt - seriesStart) / DAY_MS);
        if (idx >= 0 && idx < SERIES_DAYS) {
          ensureSeries(p.repository.toLowerCase())[idx] += 1;
          prsMergedSeries14d[idx] += 1;
          scoreEarnedSeries14d[idx] += prScore;
        }
      }
      // Merge latency in hours, recorded against the same window as the
      // PRs-merged buckets so deltas line up.
      const ct = p.prCreatedAt ? Date.parse(p.prCreatedAt) : NaN;
      if (Number.isFinite(ct) && ct <= mt) {
        const hours = (mt - ct) / (60 * 60 * 1000);
        if (mt >= weekAgo) latency7d.push(hours);
        else if (mt >= twoWeeksAgo) latencyPriorWeek.push(hours);
      }
    }
    const t = p.prCreatedAt ? Date.parse(p.prCreatedAt) : 0;
    if (t > a.lastPrAt) a.lastPrAt = t;
    if (t >= weekAgo) a.prsThisWeek += 1;
    else if (t >= twoWeeksAgo) a.prsLastWeek += 1;
  }

  const repos: GtRepo[] = reposRaw.map((r) => {
    const a = aggMap.get(r.fullName.toLowerCase());
    const prsThisWeek = a?.prsThisWeek ?? 0;
    const prsLastWeek = a?.prsLastWeek ?? 0;
    // % growth this week vs last; if last week was 0, use this week as the
    // raw count so brand-new repos still rank when sorting by trending.
    const trendingPct = prsLastWeek > 0
      ? ((prsThisWeek - prsLastWeek) / prsLastWeek) * 100
      : prsThisWeek > 0 ? prsThisWeek * 100 : 0;
    const weight = repoWeight(r);
    const inactiveAt = repoInactiveAt(r);
    const cfg = r.config ?? null;
    const lc = r.fullName.toLowerCase();
    const sn74Repo = sn74ByRepo.get(lc);
    return {
      fullName: r.fullName,
      owner: r.owner,
      name: r.name,
      weight,
      isActive: !inactiveAt,
      inactiveAt,
      totalScore: a?.totalScore ?? 0,
      totalPrCount: a?.totalPrCount ?? 0,
      mergedPrCount: a?.mergedPrCount ?? 0,
      contributorCount: a?.contributors.size ?? 0,
      collateralStaked: a?.collateralStaked ?? 0,
      prsThisWeek,
      prsLastWeek,
      trendingPct,
      lastPrAt: (() => {
        const dbT = dbLastPrByRepo.get(lc) ?? 0;
        const aggT = a?.lastPrAt ?? 0;
        const t = Math.max(dbT, aggT);
        return t > 0 ? new Date(t).toISOString() : null;
      })(),
      openPrCount: openPrByRepo.get(lc) ?? 0,
      openIssueCount: openIssueByRepo.get(lc) ?? 0,
      excessivePrPenaltyThreshold: sn74Repo?.excessivePrPenaltyThreshold ?? null,
      mergedPrSeries14d: seriesByRepo.get(lc) ?? new Array<number>(SERIES_DAYS).fill(0),
      labelMultipliers: cfg?.labelMultipliers ?? sn74Repo?.labelMultipliers ?? null,
      issueDiscoveryShare:
        typeof cfg?.issueDiscoveryShare !== 'undefined'
          ? num(cfg.issueDiscoveryShare)
          : sn74Repo?.issueDiscoveryShare ?? null,
      maintainerCut:
        typeof cfg?.maintainerCut !== 'undefined'
          ? num(cfg.maintainerCut)
          : sn74Repo?.maintainerCut ?? null,
      minCredibility: sn74Repo?.minCredibility ?? null,
      trustedLabelPipeline:
        typeof cfg?.trustedLabelPipeline === 'boolean'
          ? cfg.trustedLabelPipeline
          : sn74Repo?.trustedLabelPipeline ?? null,
      stars: starsByRepo.get(lc)?.stars ?? null,
    };
  });

  const prs: GtPrSummary[] = [...prsRaw]
    .filter((p) => p.prCreatedAt)
    .sort((a, b) => Date.parse(b.prCreatedAt) - Date.parse(a.prCreatedAt))
    .map((p) => ({
      pullRequestNumber: p.pullRequestNumber,
      title: p.pullRequestTitle,
      repository: p.repository,
      author: p.author || p.githubId || '',
      prCreatedAt: p.prCreatedAt,
      prState: p.prState,
      mergedAt: p.mergedAt,
      score: nullableNum(p.score),
      additions: nullableNum(p.additions),
      deletions: nullableNum(p.deletions),
    }));
  const recentPrs = prs.slice(0, 10);

  const totalEmissionWeight = repos.reduce(
    (s, r) => (r.isActive && Number.isFinite(r.weight) ? s + r.weight : s),
    0,
  );

  const stakedRepoCount = repos.reduce(
    (s, r) => (r.isActive && r.collateralStaked > 0 ? s + 1 : s),
    0,
  );

  // Top-5 weight concentration among active repos.
  const top5WeightSum = repos
    .filter((r) => r.isActive && Number.isFinite(r.weight))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .reduce((s, r) => s + r.weight, 0);
  const top5WeightConcentration = totalEmissionWeight > 0 ? top5WeightSum / totalEmissionWeight : 0;

  // New vs returning, classified by each contributor's earliest-ever merge.
  let newContributors7d = 0;
  let returningContributors7d = 0;
  for (const author of contributors7d) {
    const earliest = firstMergeByAuthor.get(author);
    if (earliest === undefined) continue;
    if (earliest >= weekAgo) {
      newContributors7d += 1;
    } else if (earliest < twoWeeksAgo && !contributorsPriorWeek.has(author)) {
      returningContributors7d += 1;
    }
  }

  const sortedLat7 = [...latency7d].sort((a, b) => a - b);
  const sortedLatPrior = [...latencyPriorWeek].sort((a, b) => a - b);
  const medianMergeLatencyHours7d = median(sortedLat7);
  const medianMergeLatencyHoursPriorWeek = median(sortedLatPrior);

  const next: Cached = {
    fetched_at: now,
    repos,
    recentPrs,
    prs,
    totalEmissionWeight,
    prsMergedThisWeek,
    prsMergedLastWeek,
    uniqueContributors7d: contributors7d.size,
    uniqueContributorsPriorWeek: contributorsPriorWeek.size,
    scoreEarnedThisWeek,
    scoreEarnedPriorWeek,
    stakedRepoCount,
    top5WeightConcentration,
    prsMergedSeries14d,
    scoreEarnedSeries14d,
    newContributors7d,
    returningContributors7d,
    medianMergeLatencyHours7d,
    medianMergeLatencyHoursPriorWeek,
  };
  cache = next;
  return next;
}

function payload(c: Cached, source: 'live' | 'cache' | 'stale'): GtReposResponse {
  const active = c.repos.filter((r) => r.isActive).length;
  return {
    fetched_at: c.fetched_at,
    source,
    count: c.repos.length,
    activeCount: active,
    inactiveCount: c.repos.length - active,
    totalEmissionWeight: c.totalEmissionWeight,
    prsMergedThisWeek: c.prsMergedThisWeek,
    prsMergedLastWeek: c.prsMergedLastWeek,
    uniqueContributors7d: c.uniqueContributors7d,
    uniqueContributorsPriorWeek: c.uniqueContributorsPriorWeek,
    scoreEarnedThisWeek: c.scoreEarnedThisWeek,
    scoreEarnedPriorWeek: c.scoreEarnedPriorWeek,
    stakedRepoCount: c.stakedRepoCount,
    top5WeightConcentration: c.top5WeightConcentration,
    prsMergedSeries14d: c.prsMergedSeries14d,
    scoreEarnedSeries14d: c.scoreEarnedSeries14d,
    newContributors7d: c.newContributors7d,
    returningContributors7d: c.returningContributors7d,
    medianMergeLatencyHours7d: c.medianMergeLatencyHours7d,
    medianMergeLatencyHoursPriorWeek: c.medianMergeLatencyHoursPriorWeek,
    repos: c.repos,
    recentPrs: c.recentPrs,
    prs: c.prs,
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
    if (cache) return NextResponse.json({ ...payload(cache, 'stale'), error: String(err) });
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
