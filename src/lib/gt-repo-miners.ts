import type Database from 'better-sqlite3';
import { getDb } from '@/lib/db';
import type { RepoMiner } from '@/types/entities';

export interface UpstreamMinerForRepo {
  id: string;
  githubUsername: string;
  githubId?: string | null;
  issueDiscoveryScore?: string | number | null;
}

interface IssueAuthorRow {
  author_login: string;
  issue_count: number;
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Case-insensitive match for GitHub `owner/repo` strings. */
export function repoNamesMatch(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Count issues filed in a repo by author login (local poller cache).
 * Keys are lowercased GitHub usernames.
 */
export function countIssueAuthorsInRepo(
  repoFullName: string,
  db: Database.Database = getDb(),
): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT MIN(author_login) AS author_login, COUNT(*) AS issue_count
       FROM issues
       WHERE LOWER(repo_full_name) = LOWER(?)
         AND author_login IS NOT NULL
         AND TRIM(author_login) != ''
       GROUP BY LOWER(author_login)`,
    )
    .all(repoFullName) as IssueAuthorRow[];

  const counts = new Map<string, number>();
  for (const r of rows) {
    counts.set(r.author_login.toLowerCase(), r.issue_count);
  }
  return counts;
}

/**
 * Top miners who authored issues in this repo, ranked by in-repo issue count
 * then global issueDiscoveryScore. Only includes logins present in upstream /miners.
 */
export function buildIssueDiscoveriesForRepo(
  repoFullName: string,
  miners: UpstreamMinerForRepo[],
  issueRankByGithubId: Map<string, number>,
  options?: { limit?: number; db?: Database.Database },
): RepoMiner[] {
  const limit = options?.limit ?? 10;
  const authorCounts = countIssueAuthorsInRepo(repoFullName, options?.db);
  if (authorCounts.size === 0) return [];

  const minersByLogin = new Map<string, UpstreamMinerForRepo>();
  for (const m of miners) {
    minersByLogin.set(m.githubUsername.toLowerCase(), m);
  }

  const candidates: { miner: UpstreamMinerForRepo; issueCount: number }[] = [];
  for (const [login, issueCount] of authorCounts) {
    const miner = minersByLogin.get(login);
    if (miner) candidates.push({ miner, issueCount });
  }

  candidates.sort((a, b) => {
    if (b.issueCount !== a.issueCount) return b.issueCount - a.issueCount;
    return num(b.miner.issueDiscoveryScore) - num(a.miner.issueDiscoveryScore);
  });

  return candidates.slice(0, limit).map(({ miner, issueCount }) => ({
    githubId: miner.githubId ?? '',
    githubUsername: miner.githubUsername,
    prCount: issueCount,
    score: Number(num(miner.issueDiscoveryScore).toFixed(2)),
    ossRank: miner.githubId ? issueRankByGithubId.get(miner.githubId) ?? null : null,
    avatarUrl: `https://github.com/${miner.githubUsername}.png?size=48`,
  }));
}
