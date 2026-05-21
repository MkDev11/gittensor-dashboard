import { NextRequest, NextResponse } from 'next/server';
import { getReadDb, type PullRow } from '@/lib/db';
import { authorCredibilityForRepo, getGittensorCredibilityIndex } from '@/lib/gittensor-credibility';
import { getIssueDiscoveryDisabledReposAsyncServer } from '@/lib/repos-server';

export const dynamic = 'force-dynamic';

const LIMIT_DEFAULT = 80;
const LIMIT_MAX = 200;

function positiveInt(value: string | null, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ owner: string; name: string; login: string }> },
) {
  const params = await ctx.params;
  const full = `${params.owner}/${params.name}`;
  const login = params.login;
  const url = new URL(req.url);
  const page = positiveInt(url.searchParams.get('page'), 1);
  const requestedLimit = parseInt(
    url.searchParams.get('pageSize') ?? url.searchParams.get('limit') ?? `${LIMIT_DEFAULT}`,
    10,
  ) || LIMIT_DEFAULT;
  const limit = Math.min(LIMIT_MAX, Math.max(1, requestedLimit));
  const offset = (page - 1) * limit;

  const db = getReadDb();
  const stats = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN state = 'open' AND draft = 0 AND merged = 0 THEN 1 ELSE 0 END) AS open,
         SUM(CASE WHEN draft = 1 AND merged = 0 THEN 1 ELSE 0 END) AS draft,
         SUM(CASE WHEN merged = 1 THEN 1 ELSE 0 END) AS merged,
         SUM(CASE WHEN state = 'closed' AND merged = 0 THEN 1 ELSE 0 END) AS closed,
         MAX(updated_at) AS last_updated_at
       FROM pulls
       WHERE repo_full_name = ? AND author_login = ?`,
    )
    .get(full, login) as
    | {
        total: number;
        open: number | null;
        draft: number | null;
        merged: number | null;
        closed: number | null;
        last_updated_at: string | null;
      }
    | undefined;

  const association = (
    db
      .prepare(
        `SELECT author_association
         FROM pulls
         WHERE repo_full_name = ? AND author_login = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(full, login) as { author_association: string | null } | undefined
  )?.author_association ?? null;

  const rows = db
    .prepare(
      `SELECT id, repo_full_name, number, title, NULL as body, state, draft, merged,
              author_login, author_association, created_at, updated_at, closed_at, merged_at,
              html_url, fetched_at, first_seen_at
       FROM pulls
       WHERE repo_full_name = ? AND author_login = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(full, login, limit, offset) as PullRow[];

  const total = stats?.total ?? 0;
  const [credibilityIndex, issueDiscoveryDisabledRepos] = await Promise.all([
    getGittensorCredibilityIndex([full]),
    getIssueDiscoveryDisabledReposAsyncServer([full]),
  ]);
  const issueDiscoveryDisabled = issueDiscoveryDisabledRepos.has(full.toLowerCase());
  const authorCredibility = authorCredibilityForRepo(credibilityIndex, login, full, {
    issueDiscoveryDisabled,
  });

  return NextResponse.json({
    repo: full,
    page,
    page_size: limit,
    total_pages: Math.max(1, Math.ceil(total / limit)),
    author: {
      login,
      association,
      avatar_url: `https://github.com/${encodeURIComponent(login)}.png?size=96`,
      html_url: `https://github.com/${encodeURIComponent(login)}`,
      credibility: authorCredibility,
    },
    stats: {
      total,
      open: stats?.open ?? 0,
      draft: stats?.draft ?? 0,
      merged: stats?.merged ?? 0,
      closed: stats?.closed ?? 0,
      last_updated_at: stats?.last_updated_at ?? null,
    },
    pulls: rows.map((r) => ({
      ...r,
      author_credibility: authorCredibilityForRepo(credibilityIndex, r.author_login, r.repo_full_name, {
        issueDiscoveryDisabled,
      }),
    })),
  });
}
