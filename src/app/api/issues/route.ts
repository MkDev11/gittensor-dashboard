import { NextRequest, NextResponse } from 'next/server';
import { getReadDb, IssueRow } from '@/lib/db';
import { getLiveReposAsyncServer } from '@/lib/repos-server';
import { backfillPrIssueLinksIfNeeded } from '@/lib/refresh';
import { authorCredibilityForLogin, getGittensorCredibilityMap } from '@/lib/gittensor-credibility';

export const dynamic = 'force-dynamic';

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;
const SINCE_LIMIT = 200;

type SortKey = 'opened' | 'closed' | 'updated' | 'comments' | 'repo' | 'weight' | 'number';
type SortDir = 'asc' | 'desc';

interface LinkedPullRow {
  repo_full_name: string;
  issue_number: number;
  number: number;
  title: string;
  state: string;
  draft: number;
  merged: number;
  author_login: string | null;
}

const HAS_MERGED_PR_SQL =
  `EXISTS (SELECT 1 FROM pr_issue_links l
           JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
           WHERE l.repo_full_name = i.repo_full_name AND l.issue_number = i.number AND p.merged = 1)`;

function positiveInt(value: string | null, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseLabels(labels: string | null): unknown[] {
  if (!labels) return [];
  try {
    const parsed = JSON.parse(labels);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeRepoList(raw: string | null): string[] | null {
  if (raw === null) return null;
  const seen = new Set<string>();
  const repos: string[] = [];
  for (const part of raw.split(',')) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    repos.push(name);
  }
  return repos;
}

async function resolveRepoScope(reqRepos: string[] | null): Promise<string[]> {
  const { repos: liveRepos } = await getLiveReposAsyncServer();
  const db = getReadDb();
  const userRows = db
    .prepare('SELECT full_name FROM user_repos')
    .all() as Array<{ full_name: string }>;

  const allowed = new Map<string, string>();
  for (const r of liveRepos) allowed.set(r.fullName.toLowerCase(), r.fullName);
  for (const r of userRows) {
    if (!allowed.has(r.full_name.toLowerCase())) allowed.set(r.full_name.toLowerCase(), r.full_name);
  }

  if (reqRepos !== null) {
    const scoped: string[] = [];
    for (const name of reqRepos) {
      const allowedName = allowed.get(name.toLowerCase());
      if (allowedName) scoped.push(allowedName);
    }
    return scoped;
  }

  return Array.from(allowed.values());
}

function addStateFilter(where: string[], state: string | null) {
  if (!state || state === 'all') return;
  if (state === 'open') {
    where.push("i.state = 'open'");
    return;
  }
  if (state === 'completed') {
    where.push(`i.state = 'closed' AND UPPER(COALESCE(i.state_reason, '')) = 'COMPLETED' AND ${HAS_MERGED_PR_SQL}`);
    return;
  }
  if (state === 'not_planned') {
    where.push("i.state = 'closed' AND UPPER(COALESCE(i.state_reason, '')) = 'NOT_PLANNED'");
    return;
  }
  if (state === 'duplicate') {
    where.push("i.state = 'closed' AND UPPER(COALESCE(i.state_reason, '')) = 'DUPLICATE'");
    return;
  }
  if (state === 'closed_other') {
    where.push(
      `i.state = 'closed'
       AND UPPER(COALESCE(i.state_reason, '')) NOT IN ('NOT_PLANNED', 'DUPLICATE')
       AND NOT (UPPER(COALESCE(i.state_reason, '')) = 'COMPLETED' AND ${HAS_MERGED_PR_SQL})`,
    );
  }
}

function buildWhere({
  repos,
  q,
  since,
  state,
  close,
  author,
  includeAuthor,
}: {
  repos: string[];
  q: string;
  since: string | null;
  state: string | null;
  close: string | null;
  author: string | null;
  includeAuthor: boolean;
}): { sql: string; args: unknown[] } {
  const where: string[] = [];
  const args: unknown[] = [];

  where.push(`i.repo_full_name IN (${repos.map(() => '?').join(',')})`);
  args.push(...repos);

  if (since) {
    where.push('i.first_seen_at > ?');
    args.push(since);
  }

  if (q) {
    const like = `%${q.toLowerCase()}%`;
    where.push(
      `(LOWER(i.title) LIKE ? OR CAST(i.number AS TEXT) LIKE ? OR ('#' || i.number) LIKE ? OR LOWER(COALESCE(i.author_login, '')) LIKE ? OR LOWER(i.repo_full_name) LIKE ?)`,
    );
    args.push(like, like, like, like, like);
  }

  addStateFilter(where, state);

  if (close === 'closed') where.push("i.state = 'closed'");
  else if (close === 'still_open') where.push("i.state != 'closed'");

  if (includeAuthor && author && author !== 'all') {
    where.push('i.author_login = ?');
    args.push(author);
  }

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

function orderBy(sort: SortKey, dir: SortDir): string {
  const direction = dir === 'asc' ? 'ASC' : 'DESC';
  const col =
    sort === 'opened'
      ? "COALESCE(i.created_at, '')"
      : sort === 'closed'
      ? "COALESCE(i.closed_at, '')"
      : sort === 'updated'
      ? "COALESCE(i.updated_at, '')"
      : sort === 'comments'
      ? 'i.comments'
      : sort === 'repo'
      ? 'LOWER(i.repo_full_name)'
      : sort === 'number'
      ? 'i.number'
      : 'COALESCE(rw.weight, ur.weight, 0)';

  return `ORDER BY ${col} ${direction}, LOWER(i.repo_full_name) ASC, i.number DESC`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const reqRepos = normalizeRepoList(url.searchParams.get('repos'));
  // Watcher mode: caller passes `?since=ISO` to receive only newly-cached
  // issues. Filters on first_seen_at so we surface anything the poller picked
  // up after the watcher's baseline, regardless of GitHub's created_at.
  const since = url.searchParams.get('since');
  const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
  const state = url.searchParams.get('state');
  const close = url.searchParams.get('closed');
  const author = url.searchParams.get('author');
  const sortParam = url.searchParams.get('sort') as SortKey | null;
  const dirParam = url.searchParams.get('dir') as SortDir | null;
  const sort: SortKey =
    sortParam && ['opened', 'closed', 'updated', 'comments', 'repo', 'weight', 'number'].includes(sortParam)
      ? sortParam
      : since
      ? 'updated'
      : 'opened';
  const dir: SortDir = dirParam === 'asc' ? 'asc' : 'desc';
  const page = positiveInt(url.searchParams.get('page'), 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, positiveInt(url.searchParams.get('pageSize'), PAGE_SIZE_DEFAULT));
  const limit = since ? SINCE_LIMIT : pageSize;
  const offset = since ? 0 : (page - 1) * pageSize;

  const repos = await resolveRepoScope(reqRepos);
  if (repos.length === 0) {
    return NextResponse.json({
      count: 0,
      repo_count: 0,
      page,
      page_size: pageSize,
      total_pages: 1,
      authors: [],
      author_count: 0,
      issues: [],
    });
  }

  const db = getReadDb();
  const fromSql = `
    FROM issues i
    LEFT JOIN repo_weights rw ON rw.full_name = i.repo_full_name
    LEFT JOIN user_repos ur ON ur.full_name = i.repo_full_name
  `;
  const filteredWhere = buildWhere({
    repos,
    q,
    since,
    state,
    close,
    author,
    includeAuthor: true,
  });
  const authorWhere = buildWhere({
    repos,
    q,
    since,
    state,
    close,
    author,
    includeAuthor: false,
  });

  const totals = db
    .prepare(
      `SELECT COUNT(*) as count, COUNT(DISTINCT i.repo_full_name) as repo_count
       ${fromSql}
       ${filteredWhere.sql}`,
    )
    .get(...filteredWhere.args) as { count: number; repo_count: number };

  const authorRows = db
    .prepare(
      `SELECT i.author_login as login, COUNT(*) as count
       ${fromSql}
       ${authorWhere.sql}
       AND i.author_login IS NOT NULL
       GROUP BY i.author_login
       ORDER BY count DESC, LOWER(i.author_login) ASC
       LIMIT 2000`,
    )
    .all(...authorWhere.args) as Array<{ login: string; count: number }>;

  const rows = db
    .prepare(
      `SELECT i.id, i.repo_full_name, i.number, i.title, NULL as body, i.state, i.state_reason,
              i.author_login, i.author_association, i.labels, i.comments,
              i.created_at, i.updated_at, i.closed_at, i.html_url, i.fetched_at, i.first_seen_at
       ${fromSql}
       ${filteredWhere.sql}
       ${since ? 'ORDER BY i.first_seen_at DESC' : orderBy(sort, dir)}
       LIMIT ? OFFSET ?`,
    )
    .all(...filteredWhere.args, limit, offset) as IssueRow[];

  const linkedPrsByIssue = new Map<string, Array<{ number: number; title: string; state: string; draft: number; merged: number; author_login: string | null }>>();
  if (rows.length > 0) {
    for (const repoFullName of new Set(rows.map((r) => r.repo_full_name))) {
      backfillPrIssueLinksIfNeeded(repoFullName);
    }

    const pairWhere = rows.map(() => '(l.repo_full_name = ? AND l.issue_number = ?)').join(' OR ');
    const pairArgs = rows.flatMap((r) => [r.repo_full_name, r.number]);
    const linkRows = db
      .prepare(
        `SELECT l.repo_full_name, l.issue_number, p.number, p.title, p.state, p.draft, p.merged, p.author_login
         FROM pr_issue_links l
         JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
         WHERE ${pairWhere}
         ORDER BY l.repo_full_name ASC, l.issue_number ASC, p.number ASC`,
      )
      .all(...pairArgs) as LinkedPullRow[];
    for (const r of linkRows) {
      const key = `${r.repo_full_name}#${r.issue_number}`;
      const list = linkedPrsByIssue.get(key) ?? [];
      list.push({
        number: r.number,
        title: r.title,
        state: r.state,
        draft: r.draft,
        merged: r.merged,
        author_login: r.author_login,
      });
      linkedPrsByIssue.set(key, list);
    }
  }

  const credibilityMap = rows.length > 0 ? await getGittensorCredibilityMap() : null;
  const totalPages = Math.max(1, Math.ceil(totals.count / pageSize));

  return NextResponse.json({
    count: totals.count,
    repo_count: totals.repo_count,
    page,
    page_size: pageSize,
    total_pages: totalPages,
    authors: authorRows,
    author_count: authorRows.length,
    issues: rows.map((r) => {
      const linkedPrs = linkedPrsByIssue.get(`${r.repo_full_name}#${r.number}`) ?? [];
      return {
        ...r,
        labels: parseLabels(r.labels),
        merged_pr_count: linkedPrs.filter((pr) => pr.merged === 1).length,
        linked_prs: linkedPrs,
        author_credibility: authorCredibilityForLogin(credibilityMap, r.author_login),
      };
    }),
  });
}
