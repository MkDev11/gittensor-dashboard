import { NextRequest, NextResponse } from 'next/server';
import { getReadDb, PullRow } from '@/lib/db';
import { backfillPrIssueLinksIfNeeded, refreshIssueLinkedPrsIfStale } from '@/lib/refresh';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ owner: string; name: string; number: string }> }
) {
  const params = await ctx.params;
  const repo = `${params.owner}/${params.name}`;
  const issueNum = parseInt(params.number, 10);
  if (!Number.isFinite(issueNum)) {
    return NextResponse.json({ error: 'Invalid issue number' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  backfillPrIssueLinksIfNeeded(repo);
  await refreshIssueLinkedPrsIfStale(params.owner, params.name, issueNum);

  const db = getReadDb();
  const rows = db
    .prepare(
      `SELECT id, repo_full_name, number, title, body, state, draft, merged,
              author_login, author_association, created_at, updated_at, closed_at, merged_at,
              html_url, fetched_at, first_seen_at
       FROM pulls
       WHERE repo_full_name = ?
         AND number IN (
           SELECT pr_number
           FROM pr_issue_links
           WHERE repo_full_name = ? AND issue_number = ?
         )
       ORDER BY COALESCE(merged_at, closed_at, updated_at, created_at) ASC, number ASC`
    )
    .all(repo, repo, issueNum) as PullRow[];

  return NextResponse.json({
    repo,
    issue_number: issueNum,
    count: rows.length,
    pulls: rows,
  }, { headers: NO_STORE_HEADERS });
}
