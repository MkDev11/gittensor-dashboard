import { NextResponse } from 'next/server';
import type { RepoMiner, RepoMinersResponse } from '@/types/entities';

export const dynamic = 'force-dynamic';

const PRS_URL = 'https://api.gittensor.io/prs';
const MINERS_URL = 'https://api.gittensor.io/miners';
const TTL_MS = 30_000;

interface UpstreamPr {
  repository: string;
  author?: string | null;
  githubId?: string | null;
  mergedAt: string | null;
  score?: string | number | null;
}

interface UpstreamMiner {
  id: string;
  githubUsername: string;
  githubId?: string | null;
  totalScore?: string | number | null;
  issueDiscoveryScore?: string | number | null;
  totalSolvedIssues?: number | null;
  totalOpenIssues?: number | null;
  isIssueEligible?: boolean;
}

interface CachedShared {
  fetched_at: number;
  prs: UpstreamPr[];
  miners: UpstreamMiner[];
  ossRankByGithubId: Map<string, number>;
  issueRankByGithubId: Map<string, number>;
}

let cache: CachedShared | null = null;
let inFlight: Promise<CachedShared> | null = null;

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

async function refresh(): Promise<CachedShared> {
  const [prs, miners] = await Promise.all([
    fetch(PRS_URL, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).then((r) => r.json() as Promise<UpstreamPr[]>),
    fetch(MINERS_URL, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).then((r) => r.json() as Promise<UpstreamMiner[]>),
  ]);
  const ossRanked = [...miners].sort((a, b) => num(b.totalScore) - num(a.totalScore));
  const issueRanked = [...miners].sort((a, b) => num(b.issueDiscoveryScore) - num(a.issueDiscoveryScore));
  const ossRankByGithubId = new Map<string, number>();
  const issueRankByGithubId = new Map<string, number>();
  ossRanked.forEach((m, i) => { if (m.githubId) ossRankByGithubId.set(m.githubId, i + 1); });
  issueRanked.forEach((m, i) => { if (m.githubId) issueRankByGithubId.set(m.githubId, i + 1); });
  const next: CachedShared = { fetched_at: Date.now(), prs, miners, ossRankByGithubId, issueRankByGithubId };
  cache = next;
  return next;
}

async function getShared(): Promise<CachedShared> {
  const now = Date.now();
  if (cache && now - cache.fetched_at < TTL_MS) return cache;
  if (!inFlight) inFlight = refresh().finally(() => { inFlight = null; });
  return inFlight;
}

export async function GET(_req: Request, ctx: { params: Promise<{ owner: string; name: string }> }) {
  const params = await ctx.params;
  const fullName = `${params.owner}/${params.name}`;
  try {
    const shared = await getShared();
    const minersByGithubId = new Map<string, UpstreamMiner>();
    for (const m of shared.miners) {
      if (m.githubId) minersByGithubId.set(m.githubId, m);
    }

    // OSS Contributions: sum of merged PR scores per author for this repo.
    interface OssAgg { githubId: string; githubUsername: string; prCount: number; score: number }
    const ossMap = new Map<string, OssAgg>();
    for (const p of shared.prs) {
      if (p.repository !== fullName) continue;
      const id = p.githubId || p.author;
      if (!id) continue;
      let row = ossMap.get(id);
      if (!row) {
        row = { githubId: p.githubId || '', githubUsername: p.author || id, prCount: 0, score: 0 };
        ossMap.set(id, row);
      }
      // Count only merged PRs (matches the PRS column on the Repositories listing)
      if (p.mergedAt) row.prCount += 1;
      row.score += num(p.score);
    }
    const ossContributions: RepoMiner[] = [...ossMap.values()]
      .filter((r) => r.prCount > 0 || r.score > 0)
      .sort((a, b) => b.score - a.score || b.prCount - a.prCount)
      .slice(0, 10)
      .map((r) => {
        const m = r.githubId ? minersByGithubId.get(r.githubId) : undefined;
        const username = m?.githubUsername || r.githubUsername;
        return {
          githubId: r.githubId,
          githubUsername: username,
          prCount: r.prCount,
          score: Number(r.score.toFixed(2)),
          ossRank: r.githubId ? shared.ossRankByGithubId.get(r.githubId) ?? null : null,
          avatarUrl: `https://github.com/${username}.png?size=48`,
        };
      });

    // Issue Discoveries: miners whose githubId matches any author of issues in
    // this repo. Upstream /miners doesn't expose per-repo issue lists, so we
    // approximate: rank issue-eligible miners by issueDiscoveryScore globally
    // and surface those with > 0 totalOpenIssues.
    const issueDiscoveries: RepoMiner[] = [...shared.miners]
      .filter((m) => m.isIssueEligible && (m.totalOpenIssues ?? 0) > 0)
      .sort((a, b) => num(b.issueDiscoveryScore) - num(a.issueDiscoveryScore))
      .slice(0, 10)
      .map((m) => ({
        githubId: m.githubId ?? '',
        githubUsername: m.githubUsername,
        prCount: m.totalSolvedIssues ?? 0,
        score: Number(num(m.issueDiscoveryScore).toFixed(2)),
        ossRank: m.githubId ? shared.issueRankByGithubId.get(m.githubId) ?? null : null,
        avatarUrl: `https://github.com/${m.githubUsername}.png?size=48`,
      }));

    const body: RepoMinersResponse = {
      fullName,
      ossContributions,
      issueDiscoveries,
      fetched_at: shared.fetched_at,
    };
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
