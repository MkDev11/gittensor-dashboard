import { NextResponse } from 'next/server';
import type { GtRepo, GtPrSummary, GtReposResponse } from '@/types/entities';

export const dynamic = 'force-dynamic';

const REPOS_URL = 'https://api.gittensor.io/dash/repos';
const PRS_URL = 'https://api.gittensor.io/prs';
const TTL_MS = 30_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface UpstreamRepoConfig {
  weight?: string | number;
  inactiveAt?: string | null;
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
  inactiveAt?: string | null;
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
}

interface Cached {
  fetched_at: number;
  repos: GtRepo[];
  recentPrs: GtPrSummary[];
}

let cache: Cached | null = null;
let inFlight: Promise<Cached> | null = null;

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`upstream ${url} ${r.status}`);
  return (await r.json()) as T;
}

async function refresh(): Promise<Cached> {
  const [reposRaw, prsRaw] = await Promise.all([
    fetchJson<UpstreamRepo[]>(REPOS_URL),
    fetchJson<UpstreamPr[]>(PRS_URL),
  ]);

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
    let a = aggMap.get(k);
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
      aggMap.set(k, a);
    }
    return a;
  };

  for (const p of prsRaw) {
    const a = ensure(p.repository);
    a.totalScore += num(p.score);
    a.collateralStaked += num(p.collateralScore);
    a.totalPrCount += 1;
    if (p.mergedAt) {
      a.mergedPrCount += 1;
      const author = p.author || p.githubId;
      if (author) a.contributors.add(author);
    }
    const t = p.prCreatedAt ? Date.parse(p.prCreatedAt) : 0;
    if (t > a.lastPrAt) a.lastPrAt = t;
    if (t >= weekAgo) a.prsThisWeek += 1;
    else if (t >= twoWeeksAgo) a.prsLastWeek += 1;
  }

  const repos: GtRepo[] = reposRaw.map((r) => {
    const a = aggMap.get(r.fullName);
    const prsThisWeek = a?.prsThisWeek ?? 0;
    const prsLastWeek = a?.prsLastWeek ?? 0;
    // % growth this week vs last; if last week was 0, use this week as the
    // raw count so brand-new repos still rank when sorting by trending.
    const trendingPct = prsLastWeek > 0
      ? ((prsThisWeek - prsLastWeek) / prsLastWeek) * 100
      : prsThisWeek > 0 ? prsThisWeek * 100 : 0;
    const weight = num(r.config?.weight ?? r.weight);
    const inactiveAt = r.config?.inactiveAt ?? r.inactiveAt ?? null;
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
      lastPrAt: a?.lastPrAt ? new Date(a.lastPrAt).toISOString() : null,
    };
  });

  const recentPrs: GtPrSummary[] = [...prsRaw]
    .filter((p) => p.prCreatedAt)
    .sort((a, b) => Date.parse(b.prCreatedAt) - Date.parse(a.prCreatedAt))
    .slice(0, 10)
    .map((p) => ({
      pullRequestNumber: p.pullRequestNumber,
      title: p.pullRequestTitle,
      repository: p.repository,
      author: p.author || p.githubId || '',
      prCreatedAt: p.prCreatedAt,
      prState: p.prState,
      mergedAt: p.mergedAt,
    }));

  const next: Cached = { fetched_at: now, repos, recentPrs };
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
    repos: c.repos,
    recentPrs: c.recentPrs,
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
