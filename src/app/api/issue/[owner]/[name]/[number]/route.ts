import { NextRequest, NextResponse } from 'next/server';
import { getDb, IssueRow } from '@/lib/db';
import { withRotation } from '@/lib/github';
import { refreshIssueLinkedPrsIfStale } from '@/lib/refresh';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const GITHUB_HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
};

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

function labelsJson(labels: IssueRow['labels']) {
  if (!labels) return [];
  try {
    return JSON.parse(labels) as Array<{ name: string; color?: string | null }>;
  } catch {
    return [];
  }
}

function mergedPullCountForIssue(db: ReturnType<typeof getDb>, repoFullName: string, issueNumber: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM pr_issue_links l
       JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
       WHERE l.repo_full_name = ? AND l.issue_number = ? AND p.merged = 1`
    )
    .get(repoFullName, issueNumber) as { c: number } | undefined;
  return row?.c ?? 0;
}

function issueRowPayload(row: IssueRow, source: 'cache' | 'cache-fallback', mergedPRCount: number) {
  return {
    ...row,
    labels: labelsJson(row.labels),
    merged_pr_count: mergedPRCount,
    source,
  };
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ owner: string; name: string; number: string }> }
) {
  const params = await ctx.params;
  const { owner, name } = params;
  const num = parseInt(params.number, 10);
  const repoFullName = `${owner}/${name}`;
  if (!Number.isFinite(num)) {
    return NextResponse.json({ error: 'Invalid issue number' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  // Fetch authoritative linked-PR refs before computing merged counts. The
  // helper is throttled and in-flight deduped, so awaiting it keeps the first
  // detail open accurate without repeatedly hammering GitHub.
  await refreshIssueLinkedPrsIfStale(owner, name, num);

  // 1. Try cache first.
  const db = getDb();
  const cached = db
    .prepare(
      `SELECT id, repo_full_name, number, title, body, state, state_reason,
              author_login, author_association, labels, comments,
              created_at, updated_at, closed_at, html_url, fetched_at, first_seen_at
       FROM issues WHERE repo_full_name = ? AND number = ?`
    )
    .get(repoFullName, num) as IssueRow | undefined;

  if (cached && cached.body !== null && cached.body.length !== 8000) {
    return NextResponse.json(
      issueRowPayload(cached, 'cache', mergedPullCountForIssue(db, repoFullName, num)),
      { headers: NO_STORE_HEADERS },
    );
  }

  // 2. Fall back to a direct GitHub fetch. Cached list rows can exist with
  // NULL bodies, and poller bodies are capped, so a cache hit is not always
  // enough for the detail view.
  try {
    const data = await withRotation(async (octokit) => {
      const resp = await octokit.issues.get({
        owner,
        repo: name,
        issue_number: num,
        headers: GITHUB_HEADERS,
      });
      return resp.data;
    });
    const now = new Date().toISOString();
    const labels = (data.labels ?? []).map((l) =>
      typeof l === 'string' ? { name: l } : { name: l.name ?? '', color: l.color ?? '' }
    );

    db.prepare(
      `INSERT INTO issues
       (repo_full_name, number, title, body, state, state_reason, author_login, author_association,
        labels, comments, created_at, updated_at, closed_at, html_url, raw_json, fetched_at, first_seen_at)
       VALUES (@repo_full_name, @number, @title, @body, @state, @state_reason, @author_login, @author_association,
               @labels, @comments, @created_at, @updated_at, @closed_at, @html_url, NULL, @fetched_at, @first_seen_at)
       ON CONFLICT(repo_full_name, number) DO UPDATE SET
         title              = excluded.title,
         body               = excluded.body,
         state              = excluded.state,
         state_reason       = excluded.state_reason,
         author_login       = excluded.author_login,
         author_association = excluded.author_association,
         labels             = excluded.labels,
         comments           = excluded.comments,
         updated_at         = excluded.updated_at,
         closed_at          = excluded.closed_at,
         html_url           = excluded.html_url,
         raw_json           = NULL,
         fetched_at         = excluded.fetched_at`
    ).run({
      repo_full_name: repoFullName,
      number: data.number,
      title: data.title,
      body: data.body ?? null,
      state: data.state,
      state_reason: data.state_reason ?? null,
      author_login: data.user?.login ?? null,
      author_association: data.author_association ?? null,
      labels: JSON.stringify(labels),
      comments: data.comments,
      created_at: data.created_at,
      updated_at: data.updated_at,
      closed_at: data.closed_at,
      html_url: data.html_url,
      fetched_at: now,
      first_seen_at: cached?.first_seen_at ?? now,
    });

    return NextResponse.json({
      id: data.id,
      repo_full_name: repoFullName,
      number: data.number,
      title: data.title,
      body: data.body ?? null,
      state: data.state,
      state_reason: data.state_reason ?? null,
      author_login: data.user?.login ?? null,
      author_association: data.author_association ?? null,
      labels,
      comments: data.comments,
      created_at: data.created_at,
      updated_at: data.updated_at,
      closed_at: data.closed_at,
      html_url: data.html_url,
      fetched_at: now,
      first_seen_at: cached?.first_seen_at ?? now,
      merged_pr_count: mergedPullCountForIssue(db, repoFullName, data.number),
      source: 'github',
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (cached) {
      return NextResponse.json(
        { ...issueRowPayload(cached, 'cache-fallback', mergedPullCountForIssue(db, repoFullName, num)), body_fetch_error: msg },
        { headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json({ error: msg }, { status: 404, headers: NO_STORE_HEADERS });
  }
}
