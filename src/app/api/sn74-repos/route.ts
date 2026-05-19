import { NextResponse } from 'next/server';
import { getLiveReposAsyncServer as getLiveReposAsync } from '@/lib/repos-server';

export const dynamic = 'force-dynamic';

/**
 * Thin live mirror of the SN74 master_repositories.json. Returns the same
 * `Sn74Repo` shape the bundled `ALL_REPOS` exports so the dashboard sidebar
 * can drop-in replace its static import without reshaping data. The poller
 * already shares this cache, so this endpoint is a cheap read of the
 * already-resident in-memory snapshot most of the time.
 */
export async function GET() {
  const { repos, source, fetchedAt } = await getLiveReposAsync();
  return NextResponse.json({
    repos,
    source,
    fetched_at: fetchedAt > 0 ? new Date(fetchedAt).toISOString() : null,
    count: repos.length,
  });
}
