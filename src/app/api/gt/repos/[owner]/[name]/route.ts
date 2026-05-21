import { NextResponse } from 'next/server';
import { withRotation } from '@/lib/github';
import { getReadDb } from '@/lib/db';
import { backfillPrIssueLinksIfNeeded } from '@/lib/refresh';

export const dynamic = 'force-dynamic';

const REPOS_URL = 'https://api.gittensor.io/dash/repos';
const PRS_URL = 'https://api.gittensor.io/prs';
const TTL_MS = 30_000;

interface UpstreamRepoConfig {
  weight?: string | number;
  emission_share?: string | number;
  emissionShare?: string | number;
  inactiveAt?: string | null;
  inactive_at?: string | null;
  eligibility_mode?: boolean;
  issueDiscoveryShare?: string | number;
  issue_discovery_share?: string | number;
}

interface UpstreamRepo {
  fullName: string;
  config?: UpstreamRepoConfig | null;
  weight?: string | number;
  emission_share?: string | number;
  emissionShare?: string | number;
  inactiveAt?: string | null;
  inactive_at?: string | null;
  eligibility_mode?: boolean;
  issueDiscoveryShare?: string | number;
  issue_discovery_share?: string | number;
}
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
  byRepo: Map<string, { totalScore: number; mergedPrCount: number; contributors: Set<string>; weight: number; isActive: boolean; issueDiscoveryShare: number }>;
}

let cache: CachedAggregates | null = null;
let inFlight: Promise<CachedAggregates> | null = null;

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

function repoWeight(repo: UpstreamRepo): number {
  return num(repo.config?.emission_share ?? repo.config?.emissionShare ?? repo.config?.weight ?? repo.emission_share ?? repo.emissionShare ?? repo.weight);
}

function repoInactiveAt(repo: UpstreamRepo): string | null {
  const inactiveAt = repo.config?.inactive_at ?? repo.config?.inactiveAt ?? repo.inactive_at ?? repo.inactiveAt ?? null;
  if (repo.config?.eligibility_mode === false || repo.eligibility_mode === false) return inactiveAt ?? 'ineligible';
  return inactiveAt;
}

function repoIssueDiscoveryShare(repo: UpstreamRepo): number {
  return num(repo.config?.issueDiscoveryShare ?? repo.config?.issue_discovery_share ?? repo.issueDiscoveryShare ?? repo.issue_discovery_share);
}

async function refresh(): Promise<CachedAggregates> {
  const [reposRaw, prsRaw] = await Promise.all([
    fetch(REPOS_URL, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).then((r) => r.json() as Promise<UpstreamRepo[]>),
    fetch(PRS_URL, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).then((r) => r.json() as Promise<UpstreamPr[]>),
  ]);
  const byRepo = new Map<string, { totalScore: number; mergedPrCount: number; contributors: Set<string>; weight: number; isActive: boolean; issueDiscoveryShare: number }>();
  for (const r of reposRaw) {
    const weight = repoWeight(r);
    const inactiveAt = repoInactiveAt(r);
    const issueDiscoveryShare = repoIssueDiscoveryShare(r);
    byRepo.set(r.fullName.toLowerCase(), { totalScore: 0, mergedPrCount: 0, contributors: new Set<string>(), weight, isActive: !inactiveAt, issueDiscoveryShare });
  }
  for (const p of prsRaw) {
    const a = byRepo.get(p.repository.toLowerCase());
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

    const a = agg.byRepo.get(fullName.toLowerCase());
    let closedIssueCount = 0;
    let completedIssueCount = 0;
    let usedFallbackClosedTotal = false;
    try {
      backfillPrIssueLinksIfNeeded(fullName);
      const HAS_MERGED_PR =
        `EXISTS (SELECT 1 FROM pr_issue_links l
                 JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
                 WHERE l.repo_full_name = i.repo_full_name AND l.issue_number = i.number AND p.merged = 1)`;
      const counts = getReadDb()
        .prepare(
          `SELECT
             SUM(CASE WHEN i.state = 'closed' THEN 1 ELSE 0 END) AS closedIssueCount,
             SUM(CASE WHEN i.state = 'closed'
                       AND UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED'
                       AND ${HAS_MERGED_PR}
                 THEN 1 ELSE 0 END) AS completedIssueCount
           FROM issues i
           WHERE LOWER(i.repo_full_name) = LOWER(?)`,
        )
        .get(fullName) as { closedIssueCount: number | null; completedIssueCount: number | null } | undefined;
      closedIssueCount = counts?.closedIssueCount ?? 0;
      completedIssueCount = counts?.completedIssueCount ?? 0;
    } catch {
      closedIssueCount = 0;
      completedIssueCount = 0;
    }

    if (closedIssueCount === 0) {
      // Fallback only for a cold local cache. It gives the total but cannot
      // safely split completed vs other closed without local PR links.
      try {
        const search = await withRotation(
          (octokit) => octokit.rest.search.issuesAndPullRequests({
            q: `repo:${fullName} is:issue is:closed`,
            per_page: 1,
          }),
          { kind: 'search' },
        );
        closedIssueCount = search.data.total_count ?? 0;
        usedFallbackClosedTotal = true;
      } catch {
        closedIssueCount = 0;
      }
    }
    const otherClosedIssueCount = usedFallbackClosedTotal ? null : Math.max(0, closedIssueCount - completedIssueCount);

    return NextResponse.json({
      fullName,
      owner: params.owner,
      name: params.name,
      // gittensor-side aggregates
      weight: a?.weight ?? null,
      isActive: a?.isActive ?? true,
      totalScore: a?.totalScore ?? 0,
      mergedPrCount: a?.mergedPrCount ?? 0,
      contributorCount: a?.contributors.size ?? 0,
      issueDiscoveryEnabled: (a?.issueDiscoveryShare ?? 0) > 0,
      issueDiscoveryShare: a?.issueDiscoveryShare ?? 0,
      closedIssueCount,
      completedIssueCount,
      otherClosedIssueCount,
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
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
