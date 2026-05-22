import { NextResponse } from 'next/server';
import type { GtRepoPr, GtRepoPrsResponse } from '@/types/entities';
import { getReadDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PRS_URL = 'https://api.gittensor.io/prs';
const TTL_MS = 30_000;

interface UpstreamPr {
  pullRequestNumber: number;
  pullRequestTitle: string;
  repository: string;
  author?: string | null;
  githubId?: string | null;
  prCreatedAt: string;
  mergedAt: string | null;
  prState: string;
  additions?: number | null;
  deletions?: number | null;
  commitCount?: number | null;
  score?: string | number | null;
}

interface Cached {
  fetched_at: number;
  byRepo: Map<string, GtRepoPr[]>;
}

let cache: Cached | null = null;
let inFlight: Promise<Cached> | null = null;

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

function deriveState(p: UpstreamPr): 'OPEN' | 'MERGED' | 'CLOSED' {
  if (p.mergedAt) return 'MERGED';
  if ((p.prState ?? '').toUpperCase() === 'CLOSED') return 'CLOSED';
  return 'OPEN';
}

function parseLinkedIssue(title: string): number | null {
  const m = title.match(/^\s*#(\d+)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function refresh(): Promise<Cached> {
  const r = await fetch(PRS_URL, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const all = (await r.json()) as UpstreamPr[];
  const byRepo = new Map<string, GtRepoPr[]>();
  for (const p of all) {
    const author = p.author || p.githubId || '';
    const row: GtRepoPr = {
      pullRequestNumber: p.pullRequestNumber,
      title: p.pullRequestTitle,
      author,
      githubId: p.githubId ?? null,
      avatarUrl: `https://github.com/${author}.png?size=48`,
      prState: deriveState(p),
      prCreatedAt: p.prCreatedAt,
      mergedAt: p.mergedAt,
      additions: p.additions ?? 0,
      deletions: p.deletions ?? 0,
      commitCount: p.commitCount ?? 0,
      score: num(p.score),
      linkedIssueNumber: parseLinkedIssue(p.pullRequestTitle ?? ''),
    };
    const repoKey = p.repository.toLowerCase();
    let list = byRepo.get(repoKey);
    if (!list) {
      list = [];
      byRepo.set(repoKey, list);
    }
    list.push(row);
  }
  const next: Cached = { fetched_at: Date.now(), byRepo };
  cache = next;
  return next;
}

async function getShared(): Promise<Cached> {
  const now = Date.now();
  if (cache && now - cache.fetched_at < TTL_MS) return cache;
  if (!inFlight) inFlight = refresh().finally(() => { inFlight = null; });
  return inFlight;
}

interface LocalPullRow {
  number: number;
  title: string;
  state: string;
  draft: number;
  merged: number;
  author_login: string | null;
  created_at: string | null;
  merged_at: string | null;
}

function localPullsForRepo(fullName: string): GtRepoPr[] {
  try {
    const rows = getReadDb()
      .prepare(
        `SELECT number, title, state, draft, merged, author_login, created_at, merged_at
         FROM pulls WHERE repo_full_name = ? COLLATE NOCASE AND draft = 0`,
      )
      .all(fullName) as LocalPullRow[];
    return rows
      .filter((r) => r.created_at)
      .map((r): GtRepoPr => {
        const author = r.author_login ?? '';
        const prState: 'OPEN' | 'MERGED' | 'CLOSED' = r.merged
          ? 'MERGED'
          : (r.state ?? '').toUpperCase() === 'OPEN'
            ? 'OPEN'
            : 'CLOSED';
        return {
          pullRequestNumber: r.number,
          title: r.title,
          author,
          githubId: null,
          avatarUrl: author ? `https://github.com/${author}.png?size=48` : '',
          prState,
          prCreatedAt: r.created_at as string,
          mergedAt: r.merged_at,
          additions: 0,
          deletions: 0,
          commitCount: 0,
          score: 0,
          linkedIssueNumber: parseLinkedIssue(r.title ?? ''),
        };
      });
  } catch {
    return [];
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ owner: string; name: string }> }) {
  const params = await ctx.params;
  const fullName = `${params.owner}/${params.name}`;
  try {
    const shared = await getShared();
    const upstream = shared.byRepo.get(fullName.toLowerCase()) ?? [];
    // Merge upstream (scored) with local DB so unscored open PRs still appear.
    // Upstream wins on conflict because it carries the scoring fields.
    const merged = [...upstream];
    const seen = new Set(upstream.map((p) => p.pullRequestNumber));
    for (const p of localPullsForRepo(fullName)) {
      if (!seen.has(p.pullRequestNumber)) {
        merged.push(p);
        seen.add(p.pullRequestNumber);
      }
    }
    // Newest first by created date.
    const sorted = merged.sort((a, b) => (Date.parse(b.prCreatedAt) || 0) - (Date.parse(a.prCreatedAt) || 0));
    const counts = {
      all: sorted.length,
      open: sorted.filter((p) => p.prState === 'OPEN').length,
      merged: sorted.filter((p) => p.prState === 'MERGED').length,
      closed: sorted.filter((p) => p.prState === 'CLOSED').length,
    };
    const body: GtRepoPrsResponse = { fullName, counts, prs: sorted, fetched_at: shared.fetched_at };
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
