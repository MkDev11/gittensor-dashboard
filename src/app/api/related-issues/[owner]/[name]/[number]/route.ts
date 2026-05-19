import { NextRequest, NextResponse } from 'next/server';
import { getDb, type IssueRow, type PullRow } from '@/lib/db';
import { withRotation, fetchPrsClosingIssuesBatch } from '@/lib/github';
import { extractLinkedIssues } from '@/lib/pr-linking';
import { backfillPrIssueLinksIfNeeded, refreshIssueLinkedPrsIfStale } from '@/lib/refresh';

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

function issuePayload(row: IssueRow, mergedPRCount: number) {
  return {
    ...row,
    labels: labelsJson(row.labels),
    merged_pr_count: mergedPRCount,
  };
}

function mergedPullCountForIssue(repoFullName: string, issueNumber: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c
       FROM pr_issue_links l
       JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
       WHERE l.repo_full_name = ? AND l.issue_number = ? AND p.merged = 1`
    )
    .get(repoFullName, issueNumber) as { c: number } | undefined;
  return row?.c ?? 0;
}

function selectPull(repoFullName: string, prNumber: number): PullRow | null {
  return (
    (getDb()
      .prepare(
        `SELECT id, repo_full_name, number, title, body, state, draft, merged,
                author_login, author_association, created_at, updated_at, closed_at, merged_at,
                html_url, fetched_at, first_seen_at
         FROM pulls WHERE repo_full_name = ? AND number = ?`
      )
      .get(repoFullName, prNumber) as PullRow | undefined) ?? null
  );
}

async function fetchPull(owner: string, repo: string, prNumber: number): Promise<PullRow | null> {
  try {
    const data = await withRotation(async (octokit) => {
      const resp = await octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
        headers: GITHUB_HEADERS,
      });
      return resp.data;
    });
    const now = new Date().toISOString();
    return {
      id: data.id,
      repo_full_name: `${owner}/${repo}`,
      number: data.number,
      title: data.title,
      body: data.body ?? null,
      state: data.state,
      draft: data.draft ? 1 : 0,
      merged: data.merged ? 1 : 0,
      author_login: data.user?.login ?? null,
      author_association: data.author_association ?? null,
      created_at: data.created_at,
      updated_at: data.updated_at,
      closed_at: data.closed_at,
      merged_at: data.merged_at,
      html_url: data.html_url,
      fetched_at: now,
      first_seen_at: now,
    };
  } catch {
    return null;
  }
}

async function fetchAndCacheIssue(owner: string, repo: string, issueNumber: number): Promise<void> {
  const repoFullName = `${owner}/${repo}`;
  const db = getDb();
  const existing = db
    .prepare('SELECT first_seen_at FROM issues WHERE repo_full_name = ? AND number = ?')
    .get(repoFullName, issueNumber) as { first_seen_at: string } | undefined;

  const data = await withRotation(async (octokit) => {
    const resp = await octokit.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
      headers: GITHUB_HEADERS,
    });
    return resp.data;
  });
  if (data.pull_request) return;

  const labels = (data.labels ?? []).map((l) =>
    typeof l === 'string' ? { name: l } : { name: l.name ?? '', color: l.color ?? '' }
  );
  const now = new Date().toISOString();
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
    first_seen_at: existing?.first_seen_at ?? now,
  });
}

function selectLinkedIssues(repoFullName: string, prNumber: number): IssueRow[] {
  return getDb()
    .prepare(
      `SELECT i.id, i.repo_full_name, i.number, i.title, i.body, i.state, i.state_reason,
              i.author_login, i.author_association, i.labels, i.comments,
              i.created_at, i.updated_at, i.closed_at, i.html_url, i.fetched_at, i.first_seen_at
       FROM pr_issue_links l
       JOIN issues i ON i.repo_full_name = l.repo_full_name AND i.number = l.issue_number
       WHERE l.repo_full_name = ? AND l.pr_number = ?
       ORDER BY i.number ASC`
    )
    .all(repoFullName, prNumber) as IssueRow[];
}

function selectRelatedPulls(repoFullName: string, issueNumber: number): PullRow[] {
  return getDb()
    .prepare(
      `SELECT p.id, p.repo_full_name, p.number, p.title, p.body, p.state, p.draft, p.merged,
              p.author_login, p.author_association, p.created_at, p.updated_at, p.closed_at, p.merged_at,
              p.html_url, p.fetched_at, p.first_seen_at
       FROM pr_issue_links l
       JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
       WHERE l.repo_full_name = ? AND l.issue_number = ?
       ORDER BY COALESCE(p.merged_at, p.closed_at, p.updated_at, p.created_at) ASC, p.number ASC`
    )
    .all(repoFullName, issueNumber) as PullRow[];
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ owner: string; name: string; number: string }> },
) {
  const params = await ctx.params;
  const { owner, name } = params;
  const prNumber = parseInt(params.number, 10);
  if (!Number.isFinite(prNumber)) {
    return NextResponse.json({ error: 'Invalid pull request number' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const repoFullName = `${owner}/${name}`;
  const db = getDb();
  backfillPrIssueLinksIfNeeded(repoFullName);

  let currentPull = selectPull(repoFullName, prNumber);
  const targetLinkCount = (db
    .prepare('SELECT COUNT(*) AS c FROM pr_issue_links WHERE repo_full_name = ? AND pr_number = ?')
    .get(repoFullName, prNumber) as { c: number }).c;

  if (targetLinkCount === 0) {
    try {
      const refs = await fetchPrsClosingIssuesBatch(owner, name, [prNumber]);
      const issueNums = refs.get(prNumber) ?? [];
      const insert = db.prepare(
        `INSERT OR IGNORE INTO pr_issue_links (repo_full_name, pr_number, issue_number)
         VALUES (?, ?, ?)`
      );
      const tx = db.transaction(() => {
        for (const issueNum of issueNums) insert.run(repoFullName, prNumber, issueNum);
      });
      tx();
    } catch {
      // Fall back below to the cached/GitHub PR body keyword parser.
    }

    currentPull = currentPull ?? await fetchPull(owner, name, prNumber);
    if (currentPull) {
      const links = extractLinkedIssues({
        title: currentPull.title,
        body: currentPull.body,
        repo_full_name: repoFullName,
      });
      const insert = db.prepare(
        `INSERT OR IGNORE INTO pr_issue_links (repo_full_name, pr_number, issue_number)
         VALUES (?, ?, ?)`
      );
      const tx = db.transaction(() => {
        for (const link of links) {
          if ((link.repo ?? repoFullName).toLowerCase() !== repoFullName.toLowerCase()) continue;
          insert.run(repoFullName, prNumber, link.number);
        }
      });
      tx();
    }
  }

  const issueNums = (db
    .prepare('SELECT issue_number FROM pr_issue_links WHERE repo_full_name = ? AND pr_number = ? ORDER BY issue_number ASC')
    .all(repoFullName, prNumber) as Array<{ issue_number: number }>).map((row) => row.issue_number);
  for (const issueNum of issueNums) {
    const cached = db
      .prepare('SELECT 1 FROM issues WHERE repo_full_name = ? AND number = ?')
      .get(repoFullName, issueNum);
    if (!cached) {
      try {
        await fetchAndCacheIssue(owner, name, issueNum);
      } catch {
        // The tab strip can still render any cached siblings; missing issues
        // should not block the PR detail itself.
      }
    }
  }

  const issueRows = selectLinkedIssues(repoFullName, prNumber);
  const primaryIssueNumber = issueRows[0]?.number ?? null;
  if (primaryIssueNumber !== null) {
    try {
      await refreshIssueLinkedPrsIfStale(owner, name, primaryIssueNumber);
    } catch {
      // Best-effort completeness. Cached links are still usable.
    }
  }

  const relatedPulls = primaryIssueNumber !== null ? selectRelatedPulls(repoFullName, primaryIssueNumber) : [];
  const hasCurrent = relatedPulls.some((pr) => pr.number === prNumber);
  if (!hasCurrent && currentPull) {
    relatedPulls.push(currentPull);
    relatedPulls.sort((a, b) => a.number - b.number);
  }

  return NextResponse.json(
    {
      repo: repoFullName,
      pull_number: prNumber,
      count: issueRows.length,
      issues: issueRows.map((row) => issuePayload(row, mergedPullCountForIssue(repoFullName, row.number))),
      related_pulls: relatedPulls,
    },
    { headers: NO_STORE_HEADERS },
  );
}
