import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MIRROR_BASE_URL = 'https://mirror.gittensor.io';
const TTL_MS = 5 * 60 * 1000;
const MAX_REPOS = 100;

interface MirrorMaintainer {
  github_id?: string | number;
  githubId?: string | number;
  login?: string;
  association?: string;
}

interface RepoMaintainers {
  repo_full_name: string;
  generated_at: string | null;
  maintainers: Array<{
    github_id: string;
    login: string;
    association: string;
  }>;
  error?: string;
}

interface Cached {
  key: string;
  fetched_at: number;
  repos: RepoMaintainers[];
}

let cache: Cached | null = null;

function normalizeRepo(value: string): string | null {
  const repo = value.trim();
  if (!repo || repo.includes('..')) return null;
  const parts = repo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return parts.join('/');
}

function githubId(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeMaintainer(raw: MirrorMaintainer): RepoMaintainers['maintainers'][number] | null {
  const id = githubId(raw.github_id ?? raw.githubId);
  if (!id || id === '0') return null;
  return {
    github_id: id,
    login: raw.login ?? '',
    association: raw.association ?? '',
  };
}

async function fetchRepoMaintainers(repo: string): Promise<RepoMaintainers> {
  const [owner, name] = repo.split('/');
  const url = `${MIRROR_BASE_URL}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/maintainers`;
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`mirror ${response.status}`);
    const body = (await response.json()) as {
      repo_full_name?: string;
      generated_at?: string | null;
      maintainers?: MirrorMaintainer[];
    };
    return {
      repo_full_name: body.repo_full_name ?? repo,
      generated_at: body.generated_at ?? null,
      maintainers: (body.maintainers ?? []).map(normalizeMaintainer).filter(Boolean) as RepoMaintainers['maintainers'],
    };
  } catch (err) {
    return {
      repo_full_name: repo,
      generated_at: null,
      maintainers: [],
      error: String(err),
    };
  }
}

export async function GET(request: NextRequest) {
  const repos = Array.from(new Set(
    (request.nextUrl.searchParams.get('repos') ?? '')
      .split(',')
      .map(normalizeRepo)
      .filter(Boolean) as string[],
  )).sort((a, b) => a.localeCompare(b));

  if (repos.length === 0) {
    return NextResponse.json({ fetched_at: Date.now(), source: 'live', count: 0, repos: [] });
  }

  if (repos.length > MAX_REPOS) {
    return NextResponse.json({ error: `Too many repos requested (max ${MAX_REPOS})` }, { status: 400 });
  }

  const key = repos.join(',');
  const now = Date.now();
  if (cache && cache.key === key && now - cache.fetched_at < TTL_MS) {
    return NextResponse.json({ fetched_at: cache.fetched_at, source: 'cache', count: cache.repos.length, repos: cache.repos });
  }

  const rows = await Promise.all(repos.map(fetchRepoMaintainers));
  cache = { key, fetched_at: now, repos: rows };
  return NextResponse.json({ fetched_at: now, source: 'live', count: rows.length, repos: rows });
}
