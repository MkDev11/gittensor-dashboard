import { NextResponse } from 'next/server';
import { withRotation } from '@/lib/github';
import type { GtRepoSummary } from '@/types/entities';

export const dynamic = 'force-dynamic';

const REPOS_URL = 'https://api.gittensor.io/dash/repos';
const PRS_URL = 'https://api.gittensor.io/prs';
const TTL_MS = 30_000;

interface UpstreamRepo { fullName: string; weight: string | number; inactiveAt?: string | null }
interface UpstreamPr {
  repository: string;
  author?: string | null;
  githubId?: string | null;
  mergedAt: string | null;
  prState?: string;
  score?: string | number | null;
}

interface CachedAggregates {
  fetched_at: number;
  byRepo: Map<string, { totalScore: number; mergedPrCount: number; contributors: Set<string>; weight: number; isActive: boolean }>;
}

let cache: CachedAggregates | null = null;
let inFlight: Promise<CachedAggregates> | null = null;

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

async function refresh(): Promise<CachedAggregates> {
  const [reposRaw, prsRaw] = await Promise.all([
    fetch(REPOS_URL, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).then((r) => r.json() as Promise<UpstreamRepo[]>),
    fetch(PRS_URL, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).then((r) => r.json() as Promise<UpstreamPr[]>),
  ]);
  const byRepo = new Map<string, { totalScore: number; mergedPrCount: number; contributors: Set<string>; weight: number; isActive: boolean }>();
  for (const r of reposRaw) {
    byRepo.set(r.fullName, { totalScore: 0, mergedPrCount: 0, contributors: new Set<string>(), weight: num(r.weight), isActive: !r.inactiveAt });
  }
  for (const p of prsRaw) {
    const a = byRepo.get(p.repository);
    if (!a) continue;
    a.totalScore += num(p.score);
    if (p.mergedAt) {
      a.mergedPrCount += 1;
      const author = p.author || p.githubId;
      if (author) a.contributors.add(author);
    }
  }
  const next: CachedAggregates = { fetched_at: Date.now(), byRepo };
  cache = next;
  return next;
}

async function getAggregates(): Promise<CachedAggregates> {
  const now = Date.now();
  if (cache && now - cache.fetched_at < TTL_MS) return cache;
  if (!inFlight) inFlight = refresh().finally(() => { inFlight = null; });
  return inFlight;
}

export async function GET(_req: Request, ctx: { params: Promise<{ owner: string; name: string }> }) {
  const params = await ctx.params;
  const fullName = `${params.owner}/${params.name}`;
  try {
    const [agg, gh] = await Promise.all([
      getAggregates(),
      withRotation((octokit) => octokit.rest.repos.get({ owner: params.owner, repo: params.name })).catch((e: unknown) => {
        const status = (e as { status?: number })?.status ?? 0;
        if (status === 404) return null;
        throw e;
      }),
    ]);

    const a = agg.byRepo.get(fullName);
    // Closed-issue count: exclude PRs (GitHub treats PRs as a kind of issue) by
    // search API. We use a single search call instead of paginating /issues.
    let closedIssueCount = 0;
    try {
      const search = await withRotation(
        (octokit) => octokit.rest.search.issuesAndPullRequests({
          q: `repo:${fullName} is:issue is:closed`,
          per_page: 1,
        }),
        { kind: 'search' },
      );
      closedIssueCount = search.data.total_count ?? 0;
    } catch {
      closedIssueCount = 0;
    }

    const body: GtRepoSummary = {
      fullName,
      owner: params.owner,
      name: params.name,
      // gittensor-side aggregates
      weight: a?.weight ?? null,
      isActive: a?.isActive ?? true,
      totalScore: a?.totalScore ?? 0,
      mergedPrCount: a?.mergedPrCount ?? 0,
      contributorCount: a?.contributors.size ?? 0,
      closedIssueCount,
      // github-side metadata (null if repo missing/private)
      github: gh
        ? {
            description: gh.data.description,
            isPrivate: gh.data.private,
            defaultBranch: gh.data.default_branch,
            htmlUrl: gh.data.html_url,
            stargazersCount: gh.data.stargazers_count,
            forksCount: gh.data.forks_count,
            openIssuesCount: gh.data.open_issues_count,
            license: gh.data.license?.spdx_id ?? null,
            topics: gh.data.topics ?? [],
            pushedAt: gh.data.pushed_at,
            createdAt: gh.data.created_at,
          }
        : null,
    };
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
