import { NextRequest, NextResponse } from 'next/server';
import { getDb, getReadDb, PullRow } from '@/lib/db';
import { refreshPullsIfStale } from '@/lib/refresh';
import { buildEtag, etagNotModified, withEtagHeaders } from '@/lib/etag';
import { authorCredibilityForLogin, getGittensorCredibilityMap } from '@/lib/gittensor-credibility';

export const dynamic = 'force-dynamic';

const PAGE_SIZE_MAX = 200;
const PAGE_SIZE_DEFAULT = 50;

type SortKey = 'opened' | 'updated' | 'closed' | 'author' | 'state';

const SORT_COLUMN: Record<SortKey, string> = {
  opened: 'created_at',
  updated: 'updated_at',
  closed: "COALESCE(merged_at, closed_at, '')",
  author: 'author_login',
  state: '__state_rank__',
};

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ owner: string; name: string }> }
) {
  const params = await ctx.params;
  const { owner, name } = params;
  const full = `${owner}/${name}`;

  // Poller handles refresh on its own cadence — see the same note in the
  // /issues route for why we don't call refresh from request handlers.
  void refreshPullsIfStale;

  const url = new URL(req.url);
  // ETag short-circuit: 304 when nothing has changed since the client's last
  // poll for this exact filter/sort/page combo.
  const db0 = getReadDb();
  const meta0 = db0
    .prepare('SELECT last_pulls_fetch, last_fetch_error FROM repo_meta WHERE full_name = ?')
    .get(full) as { last_pulls_fetch: string | null; last_fetch_error: string | null } | undefined;
  const linkCount0 = (db0
    .prepare('SELECT COUNT(*) AS c FROM pr_issue_links WHERE repo_full_name = ?')
    .get(full) as { c: number }).c;
  const etag = buildEtag([
    'pulls-v2',
    full,
    meta0?.last_pulls_fetch,
    linkCount0,
    url.searchParams.get('q'),
    url.searchParams.get('state'),
    url.searchParams.get('author'),
    url.searchParams.get('mine_login'),
    url.searchParams.get('sort'),
    url.searchParams.get('dir'),
    url.searchParams.get('since'),
    url.searchParams.get('page'),
    url.searchParams.get('pageSize'),
  ]);
  const notModified = etagNotModified(req, etag);
  if (notModified) return notModified;
  const q = (url.searchParams.get('q') ?? '').trim();
  const state = url.searchParams.get('state') ?? 'all';
  const author = url.searchParams.get('author') ?? 'all';
  const mineLogin = (url.searchParams.get('mine_login') ?? '').trim();
  const sort = (url.searchParams.get('sort') ?? 'updated') as SortKey;
  const dir = (url.searchParams.get('dir') ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const since = url.searchParams.get('since');
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const requestedSize = parseInt(url.searchParams.get('pageSize') ?? `${PAGE_SIZE_DEFAULT}`, 10) || PAGE_SIZE_DEFAULT;
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, requestedSize));
  const offset = (page - 1) * pageSize;

  const db = getReadDb();

  const buildWhere = (includeState: boolean): { sql: string; args: Array<string | number> } => {
    const where: string[] = ['repo_full_name = ?'];
    const args: Array<string | number> = [full];
    if (q) {
      const numMatch = q.match(/^#?(\d+)$/);
      if (numMatch) {
        where.push('(title LIKE ? OR number = ?)');
        args.push(`%${q}%`, Number(numMatch[1]));
      } else {
        where.push('(title LIKE ? OR author_login LIKE ?)');
        args.push(`%${q}%`, `%${q}%`);
      }
    }
    if (author !== 'all') {
      where.push('author_login = ?');
      args.push(author);
    }
    if (state === 'mine' && mineLogin) {
      where.push('LOWER(author_login) = ?');
      args.push(mineLogin.toLowerCase());
    }
    if (includeState) {
      if (state === 'open') where.push("state = 'open' AND draft = 0 AND merged = 0");
      else if (state === 'draft') where.push('draft = 1 AND merged = 0');
      else if (state === 'merged') where.push('merged = 1');
      else if (state === 'closed') where.push("state = 'closed' AND merged = 0");
    }
    return { sql: where.join(' AND '), args };
  };

  const { sql: whereSql, args: whereArgs } = buildWhere(true);

  let orderSql: string;
  if (sort === 'state') {
    // Mirror PullStatusBadge's bucketing: merged → draft → open → closed.
    orderSql = `CASE
      WHEN merged = 1 THEN 0
      WHEN draft = 1 THEN 1
      WHEN state = 'open' THEN 2
      ELSE 3 END ${dir}, updated_at DESC`;
  } else {
    orderSql = `${SORT_COLUMN[sort] ?? 'updated_at'} ${dir}, id ${dir}`;
  }

  const rows = db
    .prepare(
      `SELECT id, repo_full_name, number, title, NULL as body, state, draft, merged,
              author_login, author_association, created_at, updated_at, closed_at, merged_at,
              html_url, fetched_at, first_seen_at
       FROM pulls
       WHERE ${whereSql}
       ORDER BY ${orderSql}
       LIMIT ? OFFSET ?`
    )
    .all(...whereArgs, pageSize, offset) as PullRow[];

  const total = (db
    .prepare(`SELECT COUNT(*) AS c FROM pulls WHERE ${whereSql}`)
    .get(...whereArgs) as { c: number }).c;

  const { sql: stateLessWhere, args: stateLessArgs } = buildWhere(false);
  const stateCountsRow = db
    .prepare(
      `SELECT
         SUM(CASE WHEN state = 'open' AND draft = 0 AND merged = 0 THEN 1 ELSE 0 END) AS open,
         SUM(CASE WHEN draft = 1 AND merged = 0 THEN 1 ELSE 0 END) AS draft,
         SUM(CASE WHEN merged = 1 THEN 1 ELSE 0 END) AS merged,
         SUM(CASE WHEN state = 'closed' AND merged = 0 THEN 1 ELSE 0 END) AS closed
       FROM pulls WHERE ${stateLessWhere}`
    )
    .get(...stateLessArgs) as { open: number | null; draft: number | null; merged: number | null; closed: number | null };
  const state_counts = {
    open: stateCountsRow.open ?? 0,
    draft: stateCountsRow.draft ?? 0,
    merged: stateCountsRow.merged ?? 0,
    closed: stateCountsRow.closed ?? 0,
  };

  let new_count: number | undefined;
  if (since) {
    new_count = (db
      .prepare(`SELECT COUNT(*) AS c FROM pulls WHERE repo_full_name = ? AND first_seen_at > ?`)
      .get(full, since) as { c: number }).c;
  }

  const meta = meta0;

  // Per-page enrichment: linked issues for each PR. Same approach as the
  // mirror query in /issues — only fetch for the rows actually on this page
  // so big-repo paginations don't pay for the entire link table.
  const prNumbers = rows.map((r) => r.number);
  const linked_issues_by_pull: Record<
    number,
    Array<{ number: number; title: string; state: string; state_reason: string | null; author_login: string | null }>
  > = {};
  if (prNumbers.length > 0) {
    const placeholders = prNumbers.map(() => '?').join(',');
    const linkRows = db
      .prepare(
        `SELECT l.pr_number, i.number AS issue_number, i.title, i.state, i.state_reason, i.author_login
         FROM pr_issue_links l
         JOIN issues i ON i.repo_full_name = l.repo_full_name AND i.number = l.issue_number
         WHERE l.repo_full_name = ? AND l.pr_number IN (${placeholders})`,
      )
      .all(full, ...prNumbers) as Array<{
        pr_number: number;
        issue_number: number;
        title: string;
        state: string;
        state_reason: string | null;
        author_login: string | null;
      }>;
    for (const lr of linkRows) {
      if (!linked_issues_by_pull[lr.pr_number]) linked_issues_by_pull[lr.pr_number] = [];
      linked_issues_by_pull[lr.pr_number].push({
        number: lr.issue_number,
        title: lr.title,
        state: lr.state,
        state_reason: lr.state_reason,
        author_login: lr.author_login,
      });
    }
  }

  const credibilityMap = rows.length > 0 ? await getGittensorCredibilityMap() : null;

  return NextResponse.json(
    {
      repo: full,
      count: total,
      state_counts,
      ...(new_count !== undefined ? { new_count } : {}),
      last_fetch: meta?.last_pulls_fetch ?? null,
      last_error: meta?.last_fetch_error ?? null,
      pulls: rows.map((r) => ({
        ...r,
        author_credibility: authorCredibilityForLogin(credibilityMap, r.author_login),
      })),
      linked_issues_by_pull,
    },
    { headers: withEtagHeaders(etag) },
  );
}
