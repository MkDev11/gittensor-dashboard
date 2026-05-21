import { NextRequest, NextResponse } from 'next/server';
import { getReadDb, type IssueRow } from '@/lib/db';
import { authorCredibilityForRepo, getGittensorCredibilityIndex } from '@/lib/gittensor-credibility';
import { getIssueDiscoveryDisabledReposAsyncServer } from '@/lib/repos-server';

export const dynamic = 'force-dynamic';

const LIMIT_DEFAULT = 80;
const LIMIT_MAX = 200;

function positiveInt(value: string | null, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseLabels(raw: string | null): Array<{ name: string; color?: string }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
  const mergedPrSql = `EXISTS (
    SELECT 1 FROM pr_issue_links l
    JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
    WHERE l.repo_full_name = i.repo_full_name AND l.issue_number = i.number AND p.merged = 1
  )`;

  const stats = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN i.state = 'open' THEN 1 ELSE 0 END) AS open,
         SUM(CASE WHEN i.state = 'closed'
                   AND UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED'
                   AND ${mergedPrSql}
             THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN i.state = 'closed'
                   AND UPPER(COALESCE(i.state_reason,'')) = 'NOT_PLANNED'
             THEN 1 ELSE 0 END) AS not_planned,
         SUM(CASE WHEN i.state = 'closed'
                   AND UPPER(COALESCE(i.state_reason,'')) <> 'NOT_PLANNED'
                   AND NOT (UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED' AND ${mergedPrSql})
             THEN 1 ELSE 0 END) AS closed,
         MAX(i.updated_at) AS last_updated_at
       FROM issues i
       WHERE i.repo_full_name = ? AND i.author_login = ?`,
    )
    .get(full, login) as
    | {
        total: number;
        open: number | null;
        completed: number | null;
        not_planned: number | null;
        closed: number | null;
        last_updated_at: string | null;
      }
    | undefined;

  const association = (
    db
      .prepare(
        `SELECT author_association
         FROM issues
         WHERE repo_full_name = ? AND author_login = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(full, login) as { author_association: string | null } | undefined
  )?.author_association ?? null;

  const rows = db
    .prepare(
      `SELECT id, repo_full_name, number, title, NULL as body, state, state_reason,
              author_login, author_association, labels, comments,
              created_at, updated_at, closed_at, html_url, fetched_at, first_seen_at,
              (
                SELECT COUNT(*)
                FROM pr_issue_links l
                JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
                WHERE l.repo_full_name = i.repo_full_name
                  AND l.issue_number = i.number
                  AND p.merged = 1
              ) AS merged_pr_count
       FROM issues i
       WHERE i.repo_full_name = ? AND i.author_login = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(full, login, limit, offset) as Array<IssueRow & { merged_pr_count: number }>;

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
      completed: stats?.completed ?? 0,
      not_planned: stats?.not_planned ?? 0,
      closed: stats?.closed ?? 0,
      last_updated_at: stats?.last_updated_at ?? null,
    },
    issues: rows.map((r) => ({
      ...r,
      labels: parseLabels(r.labels),
      merged_pr_count: r.merged_pr_count,
      author_credibility: authorCredibilityForRepo(credibilityIndex, r.author_login, r.repo_full_name, {
        issueDiscoveryDisabled,
      }),
    })),
  });
}
