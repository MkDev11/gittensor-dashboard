import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getLiveReposAsyncServer } from '@/lib/repos-server';

export const dynamic = 'force-dynamic';

interface ActivityRow {
  repo: string;
  issues: number;
  pulls: number;
}

interface RepoCountRow {
  repo: string;
  cnt: number;
}

function addAllowedRepo(map: Map<string, string>, fullName: string) {
  map.set(fullName.toLowerCase(), fullName);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const since = url.searchParams.get('since') ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const db = getDb();
  const { repos: liveRepos } = await getLiveReposAsyncServer();
  const allowedRepos = new Map<string, string>();
  for (const repo of liveRepos) addAllowedRepo(allowedRepos, repo.fullName);
  const userRepos = db.prepare('SELECT full_name FROM user_repos').all() as Array<{ full_name: string }>;
  for (const repo of userRepos) addAllowedRepo(allowedRepos, repo.full_name);

  if (allowedRepos.size === 0) {
    return NextResponse.json({ since, activity: {} });
  }

  const issueRows = db
    .prepare(
      `SELECT repo_full_name as repo, COUNT(*) as cnt
       FROM issues INDEXED BY idx_issues_seen_created_repo
       WHERE created_at > ? AND first_seen_at > ?
       GROUP BY repo_full_name`
    )
    .all(since, since) as RepoCountRow[];

  const pullRows = db
    .prepare(
      `SELECT repo_full_name as repo, COUNT(*) as cnt
       FROM pulls INDEXED BY idx_pulls_seen_created_repo
       WHERE created_at > ? AND first_seen_at > ?
       GROUP BY repo_full_name`
    )
    .all(since, since) as RepoCountRow[];

  const map: Record<string, ActivityRow> = {};
  for (const r of issueRows) {
    const repo = allowedRepos.get(r.repo.toLowerCase());
    if (!repo) continue;
    map[repo] = { repo, issues: r.cnt, pulls: 0 };
  }
  for (const r of pullRows) {
    const repo = allowedRepos.get(r.repo.toLowerCase());
    if (!repo) continue;
    if (!map[repo]) map[repo] = { repo, issues: 0, pulls: r.cnt };
    else map[repo].pulls = r.cnt;
  }

  return NextResponse.json({
    since,
    activity: map,
  });
}
