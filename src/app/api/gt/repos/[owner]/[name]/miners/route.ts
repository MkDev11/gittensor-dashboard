import { NextResponse } from 'next/server';
import type { RepoMiner, RepoMinersResponse } from '@/types/entities';
import { getReadDb } from '@/lib/db';
import { backfillPrIssueLinksIfNeeded } from '@/lib/refresh';

export const dynamic = 'force-dynamic';

const PRS_URL = 'https://api.gittensor.io/prs';
const MINERS_URL = 'https://api.gittensor.io/miners';
const REPOS_URL = 'https://api.gittensor.io/dash/repos';
const TTL_MS = 30_000;
const TOP_MINERS_LIMIT = 5;

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
}

interface UpstreamRepo {
  fullName: string;
  config?: { issueDiscoveryShare?: string | number | null; issue_discovery_share?: string | number | null } | null;
  issueDiscoveryShare?: string | number | null;
  issue_discovery_share?: string | number | null;
}

interface CachedShared {
  fetched_at: number;
  prs: UpstreamPr[];
  miners: UpstreamMiner[];
  issueDiscoveryShareByRepo: Map<string, number>;
  ossRankByGithubId: Map<string, number>;
}

let cache: CachedShared | null = null;
let inFlight: Promise<CachedShared> | null = null;

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`upstream ${url} ${response.status}`);
  return response.json() as Promise<T>;
}

function localContributorsForRepo(fullName: string): RepoMiner[] {
  try {
    const rows = getReadDb()
      .prepare(
        `SELECT author_login as author, COUNT(*) as prCount,
                SUM(CASE WHEN merged = 1 THEN 1 ELSE 0 END) as mergedCount
         FROM pulls
         WHERE repo_full_name = ? COLLATE NOCASE AND author_login IS NOT NULL AND author_login != ''
         GROUP BY author_login
         ORDER BY mergedCount DESC, prCount DESC
         LIMIT ?`,
      )
      .all(fullName, TOP_MINERS_LIMIT) as Array<{ author: string; prCount: number; mergedCount: number }>;
    return rows.map((r) => ({
      githubId: '',
      githubUsername: r.author,
      prCount: r.mergedCount > 0 ? r.mergedCount : r.prCount,
      score: 0,
      ossRank: null,
      globalScore: null,
      avatarUrl: `https://github.com/${r.author}.png?size=48`,
    }));
  } catch {
    return [];
  }
}

function issueDiscoveryReason(row: {
  issueCount: number;
  maintainerIssueCount: number;
  ownerIssueCount: number;
  solvedIssueCount: number;
  sameAuthorSolvedCount: number;
  candidateIssueCount: number;
  issueDiscoveryEnabled: boolean;
}): string {
  if (!row.issueDiscoveryEnabled) return 'issue discovery disabled for repo';
  if (row.candidateIssueCount > 0) return 'can score';
  if (row.ownerIssueCount > 0) return 'repo owner cannot earn issue score';
  if (row.maintainerIssueCount > 0) return 'maintainer cannot earn issue score';
  if (row.solvedIssueCount === 0) return 'no solved issue with merged PR';
  if (row.sameAuthorSolvedCount > 0) return 'same author as solving PR';
  return 'not first issue for solving PR';
}

async function refresh(): Promise<CachedShared> {
  const [prs, miners, repos] = await Promise.all([
    fetchJson<UpstreamPr[]>(PRS_URL),
    fetchJson<UpstreamMiner[]>(MINERS_URL),
    fetchJson<UpstreamRepo[]>(REPOS_URL),
  ]);
  const issueDiscoveryShareByRepo = new Map<string, number>();
  for (const repo of repos) {
    issueDiscoveryShareByRepo.set(
      repo.fullName.toLowerCase(),
      num(repo.config?.issueDiscoveryShare ?? repo.config?.issue_discovery_share ?? repo.issueDiscoveryShare ?? repo.issue_discovery_share),
    );
  }
  const ossRanked = [...miners].sort((a, b) => num(b.totalScore) - num(a.totalScore));
  const ossRankByGithubId = new Map<string, number>();
  ossRanked.forEach((m, i) => { if (m.githubId) ossRankByGithubId.set(m.githubId, i + 1); });
  const next: CachedShared = { fetched_at: Date.now(), prs, miners, issueDiscoveryShareByRepo, ossRankByGithubId };
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
  const fullNameKey = fullName.toLowerCase();
  try {
    const shared = await getShared();
    const issueDiscoveryEnabled = (shared.issueDiscoveryShareByRepo.get(fullNameKey) ?? 0) > 0;
    const minersByGithubId = new Map<string, UpstreamMiner>();
    const minersByLogin = new Map<string, UpstreamMiner>();
    for (const m of shared.miners) {
      if (m.githubId) minersByGithubId.set(m.githubId, m);
      minersByLogin.set(m.githubUsername.toLowerCase(), m);
    }

    // OSS Contributions: sum of merged PR scores per author for this repo.
    interface OssAgg { githubId: string; githubUsername: string; prCount: number; score: number }
    const ossMap = new Map<string, OssAgg>();
    for (const p of shared.prs) {
      if (p.repository.toLowerCase() !== fullNameKey) continue;
      const id = p.githubId || p.author;
      if (!id) continue;
      let row = ossMap.get(id);
      if (!row) {
        row = { githubId: p.githubId || '', githubUsername: p.author || id, prCount: 0, score: 0 };
        ossMap.set(id, row);
      }
      // Count only merged PRs and their official PR scores.
      if (p.mergedAt) {
        row.prCount += 1;
        row.score += num(p.score);
      }
    }
    const ossAll = [...ossMap.values()].filter((r) => r.prCount > 0 || r.score > 0);
    // Captured pre-slice so the UI's share denominator covers the long tail.
    const ossContributionsTotalScore = ossAll.reduce((s, r) => s + r.score, 0);
    let ossContributions: RepoMiner[] = ossAll
      .sort((a, b) => b.score - a.score || b.prCount - a.prCount)
      .slice(0, TOP_MINERS_LIMIT)
      .map((r) => {
        const m = r.githubId ? minersByGithubId.get(r.githubId) : undefined;
        const username = m?.githubUsername || r.githubUsername;
        return {
          githubId: r.githubId,
          githubUsername: username,
          prCount: r.prCount,
          score: Number(r.score.toFixed(2)),
          ossRank: r.githubId ? shared.ossRankByGithubId.get(r.githubId) ?? null : null,
          globalScore: m ? Number(num(m.totalScore).toFixed(2)) : null,
          avatarUrl: `https://github.com/${username}.png?size=48`,
        };
      });

    // Fallback for newer repos with no scored upstream PRs: contributors
    // from local pulls cache, score=0. The muted-zero UI handles this.
    if (ossContributions.length === 0) {
      ossContributions = localContributorsForRepo(fullName);
    }

    // Issue Discoveries: repo-specific candidates only. Gittensor scores a
    // subset of solved issues: same-author issue/PR pairs and sibling issues
    // on the same solving PR are credibility-only. The hub does not have the
    // validator's per-issue earned score, so expose candidates + solved counts
    // instead of a fake score.
    backfillPrIssueLinksIfNeeded(fullName);
    const IS_MAINTAINER = `UPPER(COALESCE(i.author_association,'')) IN ('OWNER','MEMBER','COLLABORATOR')`;
    const HAS_MERGED_PR =
      `EXISTS (SELECT 1 FROM pr_issue_links l
               JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
               WHERE l.repo_full_name = i.repo_full_name AND l.issue_number = i.number AND p.merged = 1)`;
    const HAS_SAME_AUTHOR_MERGED_PR =
      `EXISTS (SELECT 1 FROM pr_issue_links l
               JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
               WHERE l.repo_full_name = i.repo_full_name
                 AND l.issue_number = i.number
                 AND p.merged = 1
                 AND LOWER(COALESCE(p.author_login,'')) = LOWER(COALESCE(i.author_login,'')))`;
    const IS_SCORE_CANDIDATE =
      `EXISTS (SELECT 1 FROM pr_issue_links l
               JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
               WHERE l.repo_full_name = i.repo_full_name
                 AND l.issue_number = i.number
                 AND p.merged = 1
                 AND LOWER(COALESCE(p.author_login,'')) <> LOWER(COALESCE(i.author_login,''))
                 AND NOT EXISTS (
                   SELECT 1 FROM pr_issue_links l2
                   JOIN issues i2 ON i2.repo_full_name = l2.repo_full_name AND i2.number = l2.issue_number
                   WHERE l2.repo_full_name = l.repo_full_name
                     AND l2.pr_number = l.pr_number
                     AND (
                       COALESCE(i2.created_at, '9999-12-31T23:59:59Z') < COALESCE(i.created_at, '9999-12-31T23:59:59Z')
                       OR (COALESCE(i2.created_at, '9999-12-31T23:59:59Z') = COALESCE(i.created_at, '9999-12-31T23:59:59Z') AND i2.number < i.number)
                     )
                 ))`;
    const issueRows = getReadDb()
      .prepare(
        `SELECT i.author_login,
                SUM(CASE WHEN i.state = 'closed' THEN 1 ELSE 0 END) AS issueCount,
                SUM(CASE WHEN i.state = 'closed' AND ${IS_MAINTAINER} THEN 1 ELSE 0 END) AS maintainerIssueCount,
                SUM(CASE WHEN i.state = 'closed' AND UPPER(COALESCE(i.author_association,'')) = 'OWNER' THEN 1 ELSE 0 END) AS ownerIssueCount,
                SUM(CASE WHEN i.state = 'closed'
                          AND UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED'
                          AND ${HAS_MERGED_PR}
                    THEN 1 ELSE 0 END) AS completedIssueCount,
                SUM(CASE WHEN i.state = 'closed'
                          AND NOT (UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED' AND ${HAS_MERGED_PR})
                    THEN 1 ELSE 0 END) AS otherClosedIssueCount,
                SUM(CASE WHEN i.state = 'closed'
                          AND UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED'
                          AND ${HAS_MERGED_PR}
                    THEN 1 ELSE 0 END) AS solvedIssueCount,
                SUM(CASE WHEN i.state = 'closed'
                          AND UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED'
                          AND ${HAS_SAME_AUTHOR_MERGED_PR}
                    THEN 1 ELSE 0 END) AS sameAuthorSolvedCount,
                SUM(CASE WHEN i.state = 'closed'
                          AND UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED'
                          AND NOT (${IS_MAINTAINER})
                          AND ${IS_SCORE_CANDIDATE}
                    THEN 1 ELSE 0 END) AS candidateIssueCount
         FROM issues i
         WHERE LOWER(i.repo_full_name) = LOWER(?) AND i.author_login IS NOT NULL
         GROUP BY LOWER(i.author_login)
         HAVING issueCount > 0`,
      )
      .all(fullName) as Array<{
        author_login: string;
        issueCount: number;
        maintainerIssueCount: number;
        ownerIssueCount: number;
        completedIssueCount: number;
        otherClosedIssueCount: number;
        solvedIssueCount: number;
        sameAuthorSolvedCount: number;
        candidateIssueCount: number;
      }>;

    const issueDiscoveries = issueRows
      .map((row) => {
        const m = minersByLogin.get(row.author_login.toLowerCase());
        if (!m) return null;
        const candidateIssueCount = issueDiscoveryEnabled ? row.candidateIssueCount : 0;
        return {
          githubId: m.githubId ?? '',
          githubUsername: m.githubUsername,
          prCount: candidateIssueCount,
          score: row.issueCount,
          issueCount: row.issueCount,
          completedIssueCount: row.completedIssueCount,
          otherClosedIssueCount: row.otherClosedIssueCount,
          solvedIssueCount: row.solvedIssueCount,
          candidateIssueCount,
          reason: issueDiscoveryEnabled ? issueDiscoveryReason({ ...row, candidateIssueCount, issueDiscoveryEnabled }) : null,
          ossRank: null,
          avatarUrl: `https://github.com/${m.githubUsername}.png?size=48`,
        };
      })
      .filter((row): row is {
        githubId: string;
        githubUsername: string;
        prCount: number;
        score: number;
        issueCount: number;
        completedIssueCount: number;
        otherClosedIssueCount: number;
        solvedIssueCount: number;
        candidateIssueCount: number;
        reason: string | null;
        ossRank: null;
        avatarUrl: string;
      } => Boolean(row))
      .sort((a, b) => b.issueCount - a.issueCount || b.candidateIssueCount - a.candidateIssueCount || b.solvedIssueCount - a.solvedIssueCount)
      .slice(0, TOP_MINERS_LIMIT);

    return NextResponse.json({
      fullName,
      issueDiscoveryEnabled,
      ossContributions,
      ossContributionsTotalScore,
      issueDiscoveries,
      fetched_at: shared.fetched_at,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
