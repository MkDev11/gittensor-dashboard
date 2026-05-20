import type { AuthorCredibility } from '@/types/entities';

const REPO_MINERS_BASE_URL = 'https://api.gittensor.io/repos';
const CREDIBILITY_TTL_MS = 30_000;
const CREDIBILITY_FETCH_TIMEOUT_MS = 2_500;
const MAX_REPO_CREDIBILITY_FETCHES = 6;
const LOGIN_FIELDS = ['githubUsername', 'github_username', 'githubLogin', 'github_login', 'username', 'author', 'login'];
const REPO_FIELDS = ['repository_full_name', 'repositoryFullName', 'repository', 'repo_full_name', 'repoFullName', 'full_name', 'fullName'];

type JsonObject = Record<string, unknown>;

interface CachedRepoCredibility {
  fetched_at: number;
  repoFullName: string;
  byLogin: Map<string, AuthorCredibility>;
}

export interface AuthorCredibilityIndex {
  byRepoLogin: Map<string, AuthorCredibility>;
}

const repoCache = new Map<string, CachedRepoCredibility>();
const repoInFlight = new Map<string, Promise<CachedRepoCredibility>>();

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(source: JsonObject, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function arrayField(source: JsonObject, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function repoKey(repoFullName: string, login: string): string {
  return `${repoFullName.trim().toLowerCase()}::${login.trim().toLowerCase()}`;
}

function normalizeRepo(repoFullName: string): string {
  return repoFullName.trim().toLowerCase();
}

function repoMinersUrl(repoFullName: string): string {
  return `${REPO_MINERS_BASE_URL}/${encodeURIComponent(repoFullName)}/miners`;
}

function credibilityFrom(source: JsonObject): AuthorCredibility {
  return {
    credibility: nullableNumber(source.credibility),
    issue_credibility: nullableNumber(source.issueCredibility ?? source.issue_credibility),
  };
}

function emptyIndex(): AuthorCredibilityIndex {
  return {
    byRepoLogin: new Map<string, AuthorCredibility>(),
  };
}

async function refreshRepoCredibility(repoFullName: string): Promise<CachedRepoCredibility> {
  const r = await fetch(repoMinersUrl(repoFullName), {
    cache: 'no-store',
    signal: AbortSignal.timeout(CREDIBILITY_FETCH_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const raw = await r.json();
  const miners = Array.isArray(raw) ? raw : isObject(raw) ? arrayField(raw, ['miners', 'data', 'rows']) : [];
  const byLogin = new Map<string, AuthorCredibility>();
  let canonicalRepo = repoFullName;

  for (const miner of miners) {
    if (!isObject(miner)) continue;
    const login = stringField(miner, LOGIN_FIELDS)?.toLowerCase() ?? null;
    if (!login) continue;
    canonicalRepo = stringField(miner, REPO_FIELDS) ?? canonicalRepo;
    byLogin.set(login, credibilityFrom(miner));
  }

  const next = { fetched_at: Date.now(), repoFullName: canonicalRepo, byLogin };
  repoCache.set(normalizeRepo(repoFullName), next);
  return next;
}

async function getRepoCredibility(repoFullName: string): Promise<CachedRepoCredibility | null> {
  const key = normalizeRepo(repoFullName);
  const cached = repoCache.get(key);
  const now = Date.now();
  if (cached && now - cached.fetched_at < CREDIBILITY_TTL_MS) return cached;

  if (!repoInFlight.has(key)) {
    repoInFlight.set(
      key,
      refreshRepoCredibility(repoFullName).finally(() => {
        repoInFlight.delete(key);
      }),
    );
  }

  try {
    return await repoInFlight.get(key)!;
  } catch {
    return cached ?? null;
  }
}

function uniqueRepos(repoFullNames: Iterable<string> | undefined): string[] {
  const repos = new Map<string, string>();
  for (const repoFullName of repoFullNames ?? []) {
    const trimmed = repoFullName.trim();
    if (!trimmed) continue;
    const key = normalizeRepo(trimmed);
    if (!repos.has(key)) repos.set(key, trimmed);
  }
  return Array.from(repos.values());
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function getGittensorCredibilityIndex(repoFullNames?: Iterable<string>): Promise<AuthorCredibilityIndex | null> {
  const repos = uniqueRepos(repoFullNames);
  if (repos.length === 0) return emptyIndex();

  const repoCredibilities = await mapWithConcurrency(
    repos,
    MAX_REPO_CREDIBILITY_FETCHES,
    (repoFullName) => getRepoCredibility(repoFullName),
  );
  const index = emptyIndex();

  for (const repoCredibility of repoCredibilities) {
    if (!repoCredibility) continue;
    for (const [login, credibility] of repoCredibility.byLogin) {
      index.byRepoLogin.set(repoKey(repoCredibility.repoFullName, login), credibility);
    }
  }

  return index;
}

export function authorCredibilityForRepo(
  index: AuthorCredibilityIndex | null,
  login: string | null,
  repoFullName: string | null,
  options?: { issueDiscoveryDisabled?: boolean },
): AuthorCredibility | null {
  const disabled = options?.issueDiscoveryDisabled === true;
  if (!index || !login) {
    return disabled ? { credibility: null, issue_credibility: null, issue_discovery_disabled: true } : null;
  }
  if (repoFullName) {
    const scoped = index.byRepoLogin.get(repoKey(repoFullName, login));
    if (scoped) {
      return disabled ? { ...scoped, issue_discovery_disabled: true } : scoped;
    }
  }
  return disabled ? { credibility: null, issue_credibility: null, issue_discovery_disabled: true } : null;
}
