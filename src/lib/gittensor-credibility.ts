import type { AuthorCredibility, Miner } from '@/types/entities';

const MINERS_URL = 'https://api.gittensor.io/miners';
const CREDIBILITY_TTL_MS = 30_000;

interface CachedCredibility {
  fetched_at: number;
  byLogin: Map<string, AuthorCredibility>;
}

let cache: CachedCredibility | null = null;
let inFlight: Promise<CachedCredibility> | null = null;

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

async function refreshCredibility(): Promise<CachedCredibility> {
  const r = await fetch(MINERS_URL, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const miners = (await r.json()) as Miner[];
  const byLogin = new Map<string, AuthorCredibility>();
  for (const miner of miners) {
    const login = miner.githubUsername?.trim().toLowerCase();
    if (!login) continue;
    byLogin.set(login, {
      credibility: nullableNumber(miner.credibility),
      issue_credibility: nullableNumber(miner.issueCredibility),
    });
  }
  const next = { fetched_at: Date.now(), byLogin };
  cache = next;
  return next;
}

export async function getGittensorCredibilityMap(): Promise<Map<string, AuthorCredibility> | null> {
  const now = Date.now();
  if (cache && now - cache.fetched_at < CREDIBILITY_TTL_MS) return cache.byLogin;
  if (!inFlight) {
    inFlight = refreshCredibility().finally(() => {
      inFlight = null;
    });
  }
  try {
    const fresh = await inFlight;
    return fresh.byLogin;
  } catch {
    return cache?.byLogin ?? null;
  }
}

export function authorCredibilityForLogin(
  byLogin: Map<string, AuthorCredibility> | null,
  login: string | null,
): AuthorCredibility | null {
  if (!byLogin || !login) return null;
  return byLogin.get(login.toLowerCase()) ?? null;
}
