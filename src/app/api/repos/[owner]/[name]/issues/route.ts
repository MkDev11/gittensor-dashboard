import { NextRequest, NextResponse } from 'next/server';
import { getDb, getReadDb, IssueRow } from '@/lib/db';
import { refreshIssuesIfStale, backfillPrIssueLinksIfNeeded } from '@/lib/refresh';
import { buildEtag, etagNotModified, withEtagHeaders } from '@/lib/etag';
import { getSessionFromCookies } from '@/lib/auth';
import { authorCredibilityForLogin, getGittensorCredibilityMap } from '@/lib/gittensor-credibility';

export const dynamic = 'force-dynamic';

const PAGE_SIZE_MAX = 200;
const PAGE_SIZE_DEFAULT = 50;

type SortKey =
  | 'opened'
  | 'updated'
  | 'closed'
  | 'author'
  | 'state'
  | 'comments'
  | 'author_open'
  | 'author_completed'
  | 'author_not_planned'
  | 'author_closed';

const SORT_COLUMN: Partial<Record<SortKey, string>> = {
  opened: 'i.created_at',
  updated: 'i.updated_at',
  closed: 'i.closed_at',
  author: 'i.author_login',
  comments: 'i.comments',
};

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ owner: string; name: string }> }
) {
  const params = await ctx.params;
  const { owner, name } = params;
  const full = `${owner}/${name}`;

  // Refresh is the poller's job — calling it from per-request handlers caused
  // a stampede when GitHub's response times spiked (each user poll spawned
  // another fetch; many in-flight fetches per repo jammed the JS event loop).
  // The cached data is normally <30s stale anyway thanks to tier-1 polling.
  void refreshIssuesIfStale; // keep import alive
  // backfillPrIssueLinksIfNeeded uses getReadDb() for the gate check, so it's
  // cheap on the steady-state path (links already populated).
  backfillPrIssueLinksIfNeeded(full);

  const url = new URL(req.url);

  // ETag: bail out with 304 when nothing in this view changed. Includes the
  // repo's last fetch (so any new data invalidates the cache) plus every
  // query param (different filters / pages produce different responses) plus
  // the caller's user id + their validation-row count so per-user
  // valid/invalid marks invalidate this user's cache without affecting others.
  const db0 = getReadDb();
  const meta0 = db0
    .prepare('SELECT last_issues_fetch, last_fetch_error FROM repo_meta WHERE full_name = ?')
    .get(full) as { last_issues_fetch: string | null; last_fetch_error: string | null } | undefined;
  const linkCount0 = (db0
    .prepare('SELECT COUNT(*) AS c FROM pr_issue_links WHERE repo_full_name = ?')
    .get(full) as { c: number }).c;
  const etagSession = await getSessionFromCookies();
  const userValidationCount = etagSession
    ? (db0
        .prepare('SELECT COUNT(*) AS c FROM issue_validations WHERE user_id = ? AND repo_full_name = ?')
        .get(etagSession.uid, full) as { c: number }).c
    : 0;
  const etag = buildEtag([
    'issues-v4',
    full,
    meta0?.last_issues_fetch,
    linkCount0,
    etagSession?.uid ?? 'anon',
    userValidationCount,
    url.searchParams.get('q'),
    url.searchParams.get('state'),
    url.searchParams.get('author'),
    url.searchParams.get('assoc'),
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
  // `assoc` filters by author_association (collaborator / contributor pseudo-
  // options at the top of the author dropdown). Mutually exclusive with the
  // login-level `author` filter — if both are set, `author` wins.
  const assoc = (url.searchParams.get('assoc') ?? '').toLowerCase();
  const sort = (url.searchParams.get('sort') ?? 'opened') as SortKey;
  const dir = (url.searchParams.get('dir') ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const since = url.searchParams.get('since');
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const requestedSize = parseInt(url.searchParams.get('pageSize') ?? `${PAGE_SIZE_DEFAULT}`, 10) || PAGE_SIZE_DEFAULT;
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, requestedSize));
  const offset = (page - 1) * pageSize;

  const db = getReadDb();

  // ---- WHERE clause assembly (parameterised; never string-interpolate user input) ----
  const where: string[] = ['i.repo_full_name = ?'];
  const args: Array<string | number> = [full];
  if (q) {
    // Match title text or "#NUMBER" exactly. Number search is exact for speed.
    const numMatch = q.match(/^#?(\d+)$/);
    if (numMatch) {
      where.push('(i.title LIKE ? OR i.number = ?)');
      args.push(`%${q}%`, Number(numMatch[1]));
    } else {
      where.push('(i.title LIKE ? OR i.author_login LIKE ?)');
      args.push(`%${q}%`, `%${q}%`);
    }
  }
  if (author !== 'all') {
    where.push('i.author_login = ?');
    args.push(author);
  } else if (assoc === 'collaborator') {
    where.push("UPPER(COALESCE(i.author_association,'')) = 'COLLABORATOR'");
  } else if (assoc === 'contributor') {
    where.push("UPPER(COALESCE(i.author_association,'')) IN ('CONTRIBUTOR','FIRST_TIME_CONTRIBUTOR','FIRST_TIMER')");
  }
  // State buckets mirror the client-side effectiveIssueState rule (which
  // mirrors Gittensor's solved-issue definition). The EXISTS subquery checks
  // pr_issue_links — populated authoritatively from `closingIssuesReferences`
  // — for at least one MERGED linked PR before granting `completed`.
  //   open        = state = 'open'
  //   completed   = closed + reason='completed' AND has ≥1 MERGED linked PR
  //   not_planned = closed + reason='not_planned'
  //   duplicate   = closed + reason='duplicate'
  //   closed      = everything else closed, including completed-without-
  //                 merged-PR (the Gittensor "risky" bucket)
  const HAS_MERGED_PR_SQL =
    `EXISTS (SELECT 1 FROM pr_issue_links l
             JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
             WHERE l.repo_full_name = i.repo_full_name AND l.issue_number = i.number AND p.merged = 1)`;
  if (state === 'open') where.push("i.state = 'open'");
  else if (state === 'completed')
    where.push(`i.state = 'closed' AND UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED' AND ${HAS_MERGED_PR_SQL}`);
  else if (state === 'not_planned')
    where.push(`i.state = 'closed' AND UPPER(COALESCE(i.state_reason,'')) = 'NOT_PLANNED'`);
  else if (state === 'duplicate')
    where.push(`i.state = 'closed' AND UPPER(COALESCE(i.state_reason,'')) = 'DUPLICATE'`);
  else if (state === 'closed')
    where.push(
      `i.state = 'closed'
       AND UPPER(COALESCE(i.state_reason,'')) NOT IN ('NOT_PLANNED','DUPLICATE')
       AND NOT (UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED' AND ${HAS_MERGED_PR_SQL})`,
    );

  const whereSql = where.join(' AND ');

  // ---- author-stats CTE only when sort needs it ----
  const needsAuthorStats =
    sort === 'author_open' ||
    sort === 'author_completed' ||
    sort === 'author_not_planned' ||
    sort === 'author_closed';
  // EXISTS subquery for "this issue has at least one merged linked PR".
  // Used by every place that classifies an issue as truly Completed.
  const HAS_MERGED_PR_FOR_S =
    `EXISTS (SELECT 1 FROM pr_issue_links l
             JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
             WHERE l.repo_full_name = s.repo_full_name AND l.issue_number = s.number AND p.merged = 1)`;
  const ctePrefix = needsAuthorStats
    ? `WITH author_stats AS (
         SELECT s.author_login,
           SUM(CASE WHEN s.state = 'open' THEN 1 ELSE 0 END) AS author_open,
           SUM(CASE WHEN s.state = 'closed'
                     AND UPPER(COALESCE(s.state_reason,'')) = 'COMPLETED'
                     AND ${HAS_MERGED_PR_FOR_S}
               THEN 1 ELSE 0 END) AS author_completed,
           SUM(CASE WHEN s.state = 'closed'
                     AND UPPER(COALESCE(s.state_reason,'')) = 'NOT_PLANNED'
               THEN 1 ELSE 0 END) AS author_not_planned,
           SUM(CASE WHEN s.state = 'closed'
                     AND UPPER(COALESCE(s.state_reason,'')) <> 'NOT_PLANNED'
                     AND NOT (UPPER(COALESCE(s.state_reason,'')) = 'COMPLETED'
                              AND ${HAS_MERGED_PR_FOR_S})
               THEN 1 ELSE 0 END) AS author_closed
         FROM issues s
         WHERE s.repo_full_name = ?
         GROUP BY s.author_login
       ) `
    : '';
  const cteArgs = needsAuthorStats ? [full] : [];
  const joinSql = needsAuthorStats
    ? 'LEFT JOIN author_stats s ON s.author_login = i.author_login'
    : '';

  // ---- ORDER BY ----
  let orderSql: string;
  if (sort === 'state') {
    orderSql = `CASE
      WHEN i.state = 'open' THEN 0
      WHEN UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED' AND ${HAS_MERGED_PR_SQL} THEN 1
      WHEN UPPER(COALESCE(i.state_reason,'')) = 'NOT_PLANNED' THEN 2
      ELSE 3 END ${dir}, i.updated_at DESC`;
  } else if (sort === 'author_open') {
    orderSql = `COALESCE(s.author_open, 0) ${dir}, i.updated_at DESC`;
  } else if (sort === 'author_completed') {
    orderSql = `COALESCE(s.author_completed, 0) ${dir}, i.updated_at DESC`;
  } else if (sort === 'author_not_planned') {
    orderSql = `COALESCE(s.author_not_planned, 0) ${dir}, i.updated_at DESC`;
  } else if (sort === 'author_closed') {
    orderSql = `COALESCE(s.author_closed, 0) ${dir}, i.updated_at DESC`;
  } else {
    const col = SORT_COLUMN[sort] ?? 'i.updated_at';
    orderSql = `${col} ${dir}, i.id ${dir}`;
  }

  // ---- main page query ----
  const rowsSql = `${ctePrefix}
    SELECT i.id, i.repo_full_name, i.number, i.title, NULL as body, i.state, i.state_reason,
           i.author_login, i.author_association, i.labels, i.comments,
           i.created_at, i.updated_at, i.closed_at, i.html_url, i.fetched_at, i.first_seen_at
    FROM issues i ${joinSql}
    WHERE ${whereSql}
    ORDER BY ${orderSql}
    LIMIT ? OFFSET ?`;
  const rows = db.prepare(rowsSql).all(...cteArgs, ...args, pageSize, offset) as IssueRow[];

  // ---- total matching the current filter ----
  const total = (db
    .prepare(`SELECT COUNT(*) AS c FROM issues i WHERE ${whereSql}`)
    .get(...args) as { c: number }).c;

  // ---- per-state counts (ignore the state filter so the dropdown shows all options' counts) ----
  const stateOnlyWhere: string[] = ['i.repo_full_name = ?'];
  const stateOnlyArgs: Array<string | number> = [full];
  if (q) {
    const numMatch = q.match(/^#?(\d+)$/);
    if (numMatch) {
      stateOnlyWhere.push('(i.title LIKE ? OR i.number = ?)');
      stateOnlyArgs.push(`%${q}%`, Number(numMatch[1]));
    } else {
      stateOnlyWhere.push('(i.title LIKE ? OR i.author_login LIKE ?)');
      stateOnlyArgs.push(`%${q}%`, `%${q}%`);
    }
  }
  if (author !== 'all') {
    stateOnlyWhere.push('i.author_login = ?');
    stateOnlyArgs.push(author);
  } else if (assoc === 'collaborator') {
    stateOnlyWhere.push("UPPER(COALESCE(i.author_association,'')) = 'COLLABORATOR'");
  } else if (assoc === 'contributor') {
    stateOnlyWhere.push("UPPER(COALESCE(i.author_association,'')) IN ('CONTRIBUTOR','FIRST_TIME_CONTRIBUTOR','FIRST_TIMER')");
  }
  const stateCountsRow = db
    .prepare(
      `SELECT
         SUM(CASE WHEN i.state = 'open' THEN 1 ELSE 0 END) AS open,
         SUM(CASE WHEN i.state = 'closed'
                  AND UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED'
                  AND ${HAS_MERGED_PR_SQL}
             THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN i.state = 'closed'
                  AND UPPER(COALESCE(i.state_reason,'')) = 'NOT_PLANNED'
             THEN 1 ELSE 0 END) AS not_planned,
         SUM(CASE WHEN i.state = 'closed'
                  AND UPPER(COALESCE(i.state_reason,'')) = 'DUPLICATE'
             THEN 1 ELSE 0 END) AS duplicate,
         SUM(CASE WHEN i.state = 'closed'
                  AND UPPER(COALESCE(i.state_reason,'')) NOT IN ('NOT_PLANNED','DUPLICATE')
                  AND NOT (UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED' AND ${HAS_MERGED_PR_SQL})
             THEN 1 ELSE 0 END) AS closed
       FROM issues i WHERE ${stateOnlyWhere.join(' AND ')}`
    )
    .get(...stateOnlyArgs) as { open: number | null; completed: number | null; not_planned: number | null; duplicate: number | null; closed: number | null };
  const state_counts = {
    open: stateCountsRow.open ?? 0,
    completed: stateCountsRow.completed ?? 0,
    not_planned: stateCountsRow.not_planned ?? 0,
    duplicate: stateCountsRow.duplicate ?? 0,
    closed: stateCountsRow.closed ?? 0,
    closed_other: 0,
  };

  // ---- new-since-baseline count ----
  let new_count: number | undefined;
  if (since) {
    new_count = (db
      .prepare(`SELECT COUNT(*) AS c FROM issues WHERE repo_full_name = ? AND first_seen_at > ?`)
      .get(full, since) as { c: number }).c;
  }

  const meta = meta0;

  // ---- per-page enrichment ----
  // Fetch linked PRs and per-author stats only for the issues on this page
  // so the repo-switch flow doesn't pay for the entire repo's data.
  const issueNumbers = rows.map((r) => r.number);
  const authorLogins = Array.from(new Set(rows.map((r) => r.author_login).filter((x): x is string => !!x)));

  const linked_prs_by_issue: Record<number, Array<{ number: number; title: string; state: string; draft: number; merged: number; author_login: string | null }>> = {};
  if (issueNumbers.length > 0) {
    const placeholders = issueNumbers.map(() => '?').join(',');
    const linkRows = db
      .prepare(
        `SELECT l.issue_number, p.number, p.title, p.state, p.draft, p.merged, p.author_login
         FROM pr_issue_links l
         JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
         WHERE l.repo_full_name = ? AND l.issue_number IN (${placeholders})`,
      )
      .all(full, ...issueNumbers) as Array<{
        issue_number: number;
        number: number;
        title: string;
        state: string;
        draft: number;
        merged: number;
        author_login: string | null;
      }>;
    for (const lr of linkRows) {
      if (!linked_prs_by_issue[lr.issue_number]) linked_prs_by_issue[lr.issue_number] = [];
      linked_prs_by_issue[lr.issue_number].push({
        number: lr.number,
        title: lr.title,
        state: lr.state,
        draft: lr.draft,
        merged: lr.merged,
        author_login: lr.author_login,
      });
    }
  }

  const page_author_stats: Record<string, { open: number; completed: number; not_planned: number; closed: number }> = {};
  if (authorLogins.length > 0) {
    const placeholders = authorLogins.map(() => '?').join(',');
    const statRows = db
      .prepare(
        `WITH merged_link_counts AS (
           SELECT l.issue_number, COUNT(*) AS cnt
           FROM pr_issue_links l
           JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
           WHERE l.repo_full_name = ? AND p.merged = 1
           GROUP BY l.issue_number
         )
         SELECT i.author_login AS login,
           SUM(CASE WHEN i.state = 'open' THEN 1 ELSE 0 END) AS open,
           SUM(CASE WHEN i.state = 'closed'
                     AND UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED'
                     AND COALESCE(mlc.cnt, 0) > 0 THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN i.state = 'closed'
                     AND UPPER(COALESCE(i.state_reason,'')) = 'NOT_PLANNED' THEN 1 ELSE 0 END) AS not_planned,
           SUM(CASE WHEN i.state = 'closed'
                     AND UPPER(COALESCE(i.state_reason,'')) <> 'NOT_PLANNED'
                     AND NOT (UPPER(COALESCE(i.state_reason,'')) = 'COMPLETED'
                              AND COALESCE(mlc.cnt, 0) > 0) THEN 1 ELSE 0 END) AS closed
         FROM issues i
         LEFT JOIN merged_link_counts mlc ON mlc.issue_number = i.number
         WHERE i.repo_full_name = ? AND i.author_login IN (${placeholders})
         GROUP BY i.author_login`,
      )
      .all(full, full, ...authorLogins) as Array<{ login: string; open: number; completed: number; not_planned: number; closed: number }>;
    for (const r of statRows) {
      page_author_stats[r.login] = { open: r.open, completed: r.completed, not_planned: r.not_planned, closed: r.closed };
    }
  }

  // Per-user valid/invalid marks for the issues on this page (if signed in).
  // Returned as a sparse map; rows without a mark simply aren't keyed.
  const session = etagSession;
  const user_validations: Record<number, 'valid' | 'invalid'> = {};
  if (session && issueNumbers.length > 0) {
    const placeholders = issueNumbers.map(() => '?').join(',');
    const rows2 = db
      .prepare(
        `SELECT issue_number, status FROM issue_validations
         WHERE user_id = ? AND repo_full_name = ? AND issue_number IN (${placeholders})`,
      )
      .all(session.uid, full, ...issueNumbers) as Array<{ issue_number: number; status: 'valid' | 'invalid' }>;
    for (const r of rows2) user_validations[r.issue_number] = r.status;
  }

  const credibilityMap = rows.length > 0 ? await getGittensorCredibilityMap() : null;

  return NextResponse.json(
    {
      repo: full,
      count: total,
      state_counts,
      ...(new_count !== undefined ? { new_count } : {}),
      last_fetch: meta?.last_issues_fetch ?? null,
      last_error: meta?.last_fetch_error ?? null,
      issues: rows.map((r) => ({
        ...r,
        labels: r.labels ? JSON.parse(r.labels) : [],
        author_credibility: authorCredibilityForLogin(credibilityMap, r.author_login),
      })),
      linked_prs_by_issue,
      page_author_stats,
      user_validations,
    },
    { headers: withEtagHeaders(etag) },
  );
}
