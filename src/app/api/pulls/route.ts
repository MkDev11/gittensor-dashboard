import { NextRequest, NextResponse } from 'next/server';
import { getReadDb, PullRow } from '@/lib/db';
import { getIssueDiscoveryDisabledReposAsyncServer, getLiveReposAsyncServer } from '@/lib/repos-server';
import { authorCredibilityForRepo, getGittensorCredibilityIndex } from '@/lib/gittensor-credibility';
import { getGittensorPrScoreMap, pullScoreKey } from '@/lib/gittensor-pr-scores';
import type { AuthorCredibility, LinkedIssueReference, PullScore } from '@/types/entities';

export const dynamic = 'force-dynamic';

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;
const SINCE_LIMIT = 3000;

type SortKey = 'updated' | 'opened' | 'closed' | 'repo' | 'weight' | 'number';
type SortDir = 'asc' | 'desc';

interface AggPullRow extends Omit<PullRow, 'body'> {
  score: PullScore | null;
  author_credibility: AuthorCredibility | null;
}

function pullIssueMapKey(repoFullName: string, prNumber: number): string {
  return `${repoFullName}#${prNumber}`;
}

function positiveInt(value: string | null, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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

function parseSinceIso(raw: string | null): string | null {
  if (!raw) return null;
  const sinceMs = Number(raw);
  if (Number.isFinite(sinceMs) && sinceMs > 0) return new Date(sinceMs).toISOString();
  const sinceDate = new Date(raw);
  return Number.isFinite(sinceDate.getTime()) ? sinceDate.toISOString() : null;
}

function addStateFilter(where: string[], state: string | null) {
  if (!state || state === 'all') return;
  if (state === 'open') {
    where.push("p.state = 'open' AND p.draft = 0 AND p.merged = 0");
    return;
  }
  if (state === 'draft') {
    where.push('p.draft = 1 AND p.merged = 0');
    return;
  }
  if (state === 'merged') {
    where.push('p.merged = 1');
    return;
  }
  if (state === 'closed') {
    where.push("p.state = 'closed' AND p.merged = 0");
  }
}

function buildWhere({
  repos,
  q,
  state,
  author,
  includeAuthor,
  sinceIso,
}: {
  repos: string[];
  q: string;
  state: string | null;
  author: string | null;
  includeAuthor: boolean;
  sinceIso: string | null;
}): { sql: string; args: unknown[] } {
  const where: string[] = [];
  const args: unknown[] = [];

  where.push(`p.repo_full_name IN (${repos.map(() => '?').join(',')})`);
  args.push(...repos);

  if (sinceIso) {
    where.push(`(
      COALESCE(p.created_at, '') >= ?
      OR COALESCE(p.updated_at, '') >= ?
      OR COALESCE(p.closed_at, '') >= ?
      OR COALESCE(p.merged_at, '') >= ?
    )`);
    args.push(sinceIso, sinceIso, sinceIso, sinceIso);
  }

  if (q) {
    const like = `%${q.toLowerCase()}%`;
    where.push(
      `(LOWER(p.title) LIKE ? OR CAST(p.number AS TEXT) LIKE ? OR ('#' || p.number) LIKE ? OR LOWER(COALESCE(p.author_login, '')) LIKE ? OR LOWER(p.repo_full_name) LIKE ?)`,
    );
    args.push(like, like, like, like, like);
  }

  addStateFilter(where, state);

  if (includeAuthor && author && author !== 'all') {
    where.push('LOWER(p.author_login) = ?');
    args.push(author.toLowerCase());
  }

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

function orderBy(sort: SortKey, dir: SortDir, sinceIso: string | null): string {
  if (sinceIso) return 'ORDER BY COALESCE(p.updated_at, p.merged_at, p.closed_at, p.created_at, p.first_seen_at) DESC';
  const direction = dir === 'asc' ? 'ASC' : 'DESC';
  const col =
    sort === 'opened'
      ? "COALESCE(p.created_at, '')"
      : sort === 'closed'
      ? "COALESCE(p.merged_at, p.closed_at, '')"
      : sort === 'repo'
      ? 'LOWER(p.repo_full_name)'
      : sort === 'number'
      ? 'p.number'
      : sort === 'weight'
      ? 'COALESCE(rw.weight, ur.weight, 0)'
      : "COALESCE(p.updated_at, '')";

  return `ORDER BY ${col} ${direction}, LOWER(p.repo_full_name) ASC, p.number DESC`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const reqRepos = normalizeRepoList(url.searchParams.get('repos'));
  const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
  const state = url.searchParams.get('state');
  const author = url.searchParams.get('author');
  const sortParam = url.searchParams.get('sort') as SortKey | null;
  const dirParam = url.searchParams.get('dir') as SortDir | null;
  const sinceIso = parseSinceIso(url.searchParams.get('since'));
  const sort: SortKey =
    sortParam && ['updated', 'opened', 'closed', 'repo', 'weight', 'number'].includes(sortParam)
      ? sortParam
      : 'updated';
  const dir: SortDir = dirParam === 'asc' ? 'asc' : 'desc';
  const page = positiveInt(url.searchParams.get('page'), 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, positiveInt(url.searchParams.get('pageSize'), PAGE_SIZE_DEFAULT));
  const limit = sinceIso ? SINCE_LIMIT : pageSize;
  const offset = sinceIso ? 0 : (page - 1) * pageSize;

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
      pulls: [],
      linked_issues_by_pull: {},
    });
  }

  const db = getReadDb();
  const fromSql = `
    FROM pulls p
    LEFT JOIN repo_weights rw ON rw.full_name = p.repo_full_name
    LEFT JOIN user_repos ur ON ur.full_name = p.repo_full_name
  `;
  const filteredWhere = buildWhere({
    repos,
    q,
    state,
    author,
    includeAuthor: true,
    sinceIso,
  });
  const authorWhere = buildWhere({
    repos,
    q,
    state,
    author,
    includeAuthor: false,
    sinceIso,
  });

  const totals = db
    .prepare(
      `SELECT COUNT(*) as count, COUNT(DISTINCT p.repo_full_name) as repo_count
       ${fromSql}
       ${filteredWhere.sql}`,
    )
    .get(...filteredWhere.args) as { count: number; repo_count: number };

  const authorRows = db
    .prepare(
      `SELECT p.author_login as login, COUNT(*) as count
       ${fromSql}
       ${authorWhere.sql}
       AND p.author_login IS NOT NULL
       GROUP BY p.author_login
       ORDER BY count DESC, LOWER(p.author_login) ASC
       LIMIT 2000`,
    )
    .all(...authorWhere.args) as Array<{ login: string; count: number }>;

  const rows = db
    .prepare(
      `SELECT p.id, p.repo_full_name, p.number, p.title, NULL as body, p.state, p.draft, p.merged,
              p.author_login, p.author_association, p.created_at, p.updated_at, p.closed_at, p.merged_at,
              p.html_url, p.fetched_at, p.first_seen_at
       ${fromSql}
       ${filteredWhere.sql}
       ${orderBy(sort, dir, sinceIso)}
       LIMIT ? OFFSET ?`,
    )
    .all(...filteredWhere.args, limit, offset) as PullRow[];

  const rowRepoNames = rows.map((r) => r.repo_full_name);
  const [scoreMap, credibilityIndex, issueDiscoveryDisabledRepos] = rows.length > 0
    ? await Promise.all([
        getGittensorPrScoreMap(),
        getGittensorCredibilityIndex(rowRepoNames),
        getIssueDiscoveryDisabledReposAsyncServer(rowRepoNames),
      ])
    : [null, null, new Set<string>()];

  const linked_issues_by_pull: Record<string, LinkedIssueReference[]> = {};
  if (rows.length > 0) {
    const uniquePulls = Array.from(
      new Map(rows.map((r) => [pullIssueMapKey(r.repo_full_name, r.number), r])).values(),
    );
    const where = uniquePulls.map(() => '(l.repo_full_name = ? AND l.pr_number = ?)').join(' OR ');
    const args = uniquePulls.flatMap((r) => [r.repo_full_name, r.number]);
    const linkRows = db
      .prepare(
        `SELECT l.repo_full_name, l.pr_number, i.number AS issue_number, i.title, i.state, i.state_reason, i.author_login
         FROM pr_issue_links l
         JOIN issues i ON i.repo_full_name = l.repo_full_name AND i.number = l.issue_number
         WHERE ${where}
         ORDER BY LOWER(l.repo_full_name) ASC, l.pr_number DESC, i.number ASC`,
      )
      .all(...args) as Array<{
        repo_full_name: string;
        pr_number: number;
        issue_number: number;
        title: string;
        state: string;
        state_reason: string | null;
        author_login: string | null;
      }>;
    for (const lr of linkRows) {
      const key = pullIssueMapKey(lr.repo_full_name, lr.pr_number);
      if (!linked_issues_by_pull[key]) linked_issues_by_pull[key] = [];
      linked_issues_by_pull[key].push({
        number: lr.issue_number,
        title: lr.title,
        state: lr.state,
        state_reason: lr.state_reason,
        author_login: lr.author_login,
      });
    }
  }

  const totalPages = Math.max(1, Math.ceil(totals.count / pageSize));
  const pulls: AggPullRow[] = rows.map((r) => ({
    ...r,
    score: scoreMap?.get(pullScoreKey(r.repo_full_name, r.number)) ?? null,
    author_credibility: authorCredibilityForRepo(credibilityIndex, r.author_login, r.repo_full_name, {
      issueDiscoveryDisabled: issueDiscoveryDisabledRepos.has(r.repo_full_name.toLowerCase()),
    }),
  }));

  return NextResponse.json({
    count: totals.count,
    repo_count: totals.repo_count,
    page,
    page_size: pageSize,
    total_pages: totalPages,
    authors: authorRows,
    author_count: authorRows.length,
    pulls,
    linked_issues_by_pull,
  });
}
