import { NextRequest, NextResponse } from 'next/server';
import { getReadDb, PullRow } from '@/lib/db';
import { getLiveReposAsyncServer } from '@/lib/repos-server';
import { authorCredibilityForLogin, getGittensorCredibilityMap } from '@/lib/gittensor-credibility';
import type { AuthorCredibility } from '@/types/entities';

export const dynamic = 'force-dynamic';

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;
const GITTENSOR_PRS_URL = 'https://api.gittensor.io/prs';
const GITTENSOR_SCORE_TTL_MS = 30_000;

type SortKey = 'updated' | 'opened' | 'closed' | 'repo' | 'weight' | 'number';
type SortDir = 'asc' | 'desc';

interface PullScore {
  score: number | null;
  collateral_score: number | null;
}

interface AggPullRow extends Omit<PullRow, 'body'> {
  score: PullScore | null;
  author_credibility: AuthorCredibility | null;
}

interface UpstreamGittensorPr {
  repository: string;
  pullRequestNumber: number;
  score?: string | number | null;
  potentialScore?: string | number | null;
  collateralScore?: string | number | null;
  collateral_score?: string | number | null;
}

interface CachedGittensorScores {
  fetched_at: number;
  byPull: Map<string, PullScore>;
}

let scoreCache: CachedGittensorScores | null = null;
let scoreInFlight: Promise<CachedGittensorScores> | null = null;

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
}: {
  repos: string[];
  q: string;
  state: string | null;
  author: string | null;
  includeAuthor: boolean;
}): { sql: string; args: unknown[] } {
  const where: string[] = [];
  const args: unknown[] = [];

  where.push(`p.repo_full_name IN (${repos.map(() => '?').join(',')})`);
  args.push(...repos);

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

function orderBy(sort: SortKey, dir: SortDir): string {
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

function scoreKey(repoFullName: string, prNumber: number): string {
  return `${repoFullName.toLowerCase()}#${prNumber}`;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

async function refreshGittensorScores(): Promise<CachedGittensorScores> {
  const r = await fetch(GITTENSOR_PRS_URL, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const raw = (await r.json()) as UpstreamGittensorPr[];
  const byPull = new Map<string, PullScore>();
  for (const pr of raw) {
    const number = Number(pr.pullRequestNumber);
    if (!pr.repository || !Number.isFinite(number)) continue;
    byPull.set(scoreKey(pr.repository, number), {
      score: nullableNumber(pr.potentialScore ?? pr.score),
      collateral_score: nullableNumber(pr.collateralScore ?? pr.collateral_score),
    });
  }
  const next = { fetched_at: Date.now(), byPull };
  scoreCache = next;
  return next;
}

async function getGittensorScoreMap(): Promise<Map<string, PullScore> | null> {
  const now = Date.now();
  if (scoreCache && now - scoreCache.fetched_at < GITTENSOR_SCORE_TTL_MS) return scoreCache.byPull;
  if (!scoreInFlight) {
    scoreInFlight = refreshGittensorScores().finally(() => {
      scoreInFlight = null;
    });
  }
  try {
    const scores = await scoreInFlight;
    return scores.byPull;
  } catch {
    return scoreCache?.byPull ?? null;
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const reqRepos = normalizeRepoList(url.searchParams.get('repos'));
  const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
  const state = url.searchParams.get('state');
  const author = url.searchParams.get('author');
  const sortParam = url.searchParams.get('sort') as SortKey | null;
  const dirParam = url.searchParams.get('dir') as SortDir | null;
  const sort: SortKey =
    sortParam && ['updated', 'opened', 'closed', 'repo', 'weight', 'number'].includes(sortParam)
      ? sortParam
      : 'updated';
  const dir: SortDir = dirParam === 'asc' ? 'asc' : 'desc';
  const page = positiveInt(url.searchParams.get('page'), 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, positiveInt(url.searchParams.get('pageSize'), PAGE_SIZE_DEFAULT));
  const offset = (page - 1) * pageSize;

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
  });
  const authorWhere = buildWhere({
    repos,
    q,
    state,
    author,
    includeAuthor: false,
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
       ${orderBy(sort, dir)}
       LIMIT ? OFFSET ?`,
    )
    .all(...filteredWhere.args, pageSize, offset) as PullRow[];

  const [scoreMap, credibilityMap] = rows.length > 0
    ? await Promise.all([getGittensorScoreMap(), getGittensorCredibilityMap()])
    : [null, null];

  const totalPages = Math.max(1, Math.ceil(totals.count / pageSize));
  const pulls: AggPullRow[] = rows.map((r) => ({
    ...r,
    score: scoreMap?.get(scoreKey(r.repo_full_name, r.number)) ?? null,
    author_credibility: authorCredibilityForLogin(credibilityMap, r.author_login),
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
  });
}
