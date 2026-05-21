import { Octokit } from '@octokit/rest';

interface PatClient {
  index: number;
  tokenSuffix: string;
  octokit: Octokit;
  // Tracked from response headers (best-effort)
  coreRemaining: number;
  coreLimit: number;
  coreResetAt: number; // epoch ms
  searchRemaining: number;
  searchLimit: number;
  searchResetAt: number; // epoch ms
  // Local back-off if we hit a secondary/abuse limit (or 403 with no remaining)
  cooldownUntil: number; // epoch ms
  lastError: string | null;
}

function loadTokens(): string[] {
  const multi = process.env.GITHUB_PATS;
  if (multi && multi.trim()) {
    return multi.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const single = process.env.GITHUB_PAT;
  return single ? [single.trim()] : [];
}

// Returns a `fetch`-compatible function that aborts any request that runs
// longer than `ms`. Works around Octokit not exposing a per-request timeout.
function timeoutFetch(ms: number): typeof fetch {
  const wrapper = (input: RequestInfo | URL, init?: RequestInit) => {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    // If the caller already passed a signal, forward its abort to ours.
    if (init?.signal) {
      if (init.signal.aborted) ctrl.abort();
      else init.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }
    return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(id));
  };
  return wrapper as unknown as typeof fetch;
}

function buildClient(token: string, index: number): PatClient {
  const client: PatClient = {
    index,
    tokenSuffix: token.slice(-4),
    octokit: new Octokit({
      auth: token,
      userAgent: 'gittensor-miner-dashboard/0.1',
      // Cap each GitHub fetch at 30s so a slow/erroring upstream doesn't
      // pile up requests on the JS event loop while we wait. Octokit will
      // surface this as a typical request error, which our caller handles.
      request: { fetch: timeoutFetch(30_000) },
    }),
    coreRemaining: 5000,
    coreLimit: 5000,
    coreResetAt: 0,
    searchRemaining: 30,
    searchLimit: 30,
    searchResetAt: 0,
    cooldownUntil: 0,
    lastError: null,
  };

  client.octokit.hook.after('request', (response, options) => {
    recordHeaders(client, response.headers as Record<string, unknown>, kindFromUrl(String(options.url ?? '')));
  });
  client.octokit.hook.error('request', (error, options) => {
    const e = error as { response?: { headers?: Record<string, unknown> } };
    if (e.response?.headers) {
      recordHeaders(client, e.response.headers, kindFromUrl(String(options.url ?? '')));
    }
    throw error;
  });

  return client;
}

function kindFromUrl(url: string): 'core' | 'search' {
  return url.includes('/search/') ? 'search' : 'core';
}

function recordHeaders(client: PatClient, headers: Record<string, unknown>, kind: 'core' | 'search') {
  const remaining = Number(headers['x-ratelimit-remaining']);
  const limit = Number(headers['x-ratelimit-limit']);
  const reset = Number(headers['x-ratelimit-reset']);
  if (Number.isFinite(remaining)) {
    if (kind === 'search') client.searchRemaining = remaining;
    else client.coreRemaining = remaining;
  }
  if (Number.isFinite(limit)) {
    if (kind === 'search') client.searchLimit = limit;
    else client.coreLimit = limit;
  }
  if (Number.isFinite(reset)) {
    if (kind === 'search') client.searchResetAt = reset * 1000;
    else client.coreResetAt = reset * 1000;
  }
}

const tokens = loadTokens();
const clients: PatClient[] = tokens.map(buildClient);

if (clients.length === 0) {
  // Surface this once at startup; callers will throw a clearer error on use.
  console.warn('[github] No GitHub PATs configured. Set GITHUB_PATS (comma-separated) or GITHUB_PAT in .env.local');
} else {
  console.log(`[github] ${clients.length} PAT${clients.length === 1 ? '' : 's'} configured for rotation`);
}

let rrCursor = 0;

function pickClient(kind: 'core' | 'search'): PatClient {
  if (clients.length === 0) throw new Error('No GitHub PATs configured');
  const now = Date.now();
  const eligible = clients.filter((c) => c.cooldownUntil <= now);
  const pool = eligible.length > 0 ? eligible : clients;
  // Prefer the client with the highest remaining quota for this kind
  pool.sort((a, b) => {
    const aR = kind === 'search' ? a.searchRemaining : a.coreRemaining;
    const bR = kind === 'search' ? b.searchRemaining : b.coreRemaining;
    if (aR !== bR) return bR - aR;
    return a.index - b.index;
  });
  // Round-robin among the top tier (within 100 calls of the leader) to spread load
  const top = pool[0];
  const topR = kind === 'search' ? top.searchRemaining : top.coreRemaining;
  const tier = pool.filter((c) => {
    const r = kind === 'search' ? c.searchRemaining : c.coreRemaining;
    return topR - r <= 100;
  });
  const chosen = tier[rrCursor % tier.length];
  rrCursor += 1;
  return chosen;
}

interface RotationOptions {
  kind?: 'core' | 'search';
  // Maximum attempts beyond the natural client count (in case all tokens are cooling down briefly)
  maxAttempts?: number;
}

export async function withRotation<T>(
  fn: (octokit: Octokit) => Promise<T>,
  opts: RotationOptions = {},
): Promise<T> {
  if (clients.length === 0) throw new Error('No GitHub PATs configured');
  const kind = opts.kind ?? 'core';
  const maxAttempts = opts.maxAttempts ?? Math.max(clients.length, 2);
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const client = pickClient(kind);
    try {
      return await fn(client.octokit);
    } catch (err) {
      lastErr = err as Error;
      const e = err as {
        status?: number;
        message?: string;
        response?: { headers?: Record<string, unknown> };
      };
      const headers = e.response?.headers ?? {};
      const remaining = Number(headers['x-ratelimit-remaining'] ?? -1);
      const isPrimary = e.status === 403 && remaining === 0;
      const isSecondary =
        (e.status === 403 || e.status === 429) &&
        /secondary rate limit|abuse|too many requests/i.test(String(e.message ?? ''));
      const retryAfter = Number(headers['retry-after'] ?? 0);

      if (isSecondary) {
        const cooldown = Math.max(retryAfter * 1000, 30_000);
        client.cooldownUntil = Date.now() + cooldown;
        client.lastError = `secondary rate limit (cooldown ${Math.round(cooldown / 1000)}s)`;
        continue;
      }
      if (isPrimary) {
        client.cooldownUntil = client.coreResetAt || Date.now() + 60_000;
        client.lastError = 'primary rate limit (waiting for reset)';
        continue;
      }
      // Non-rate-limit errors: bubble up immediately
      throw err;
    }
  }
  throw lastErr ?? new Error('All GitHub PATs are rate-limited');
}

export function getOctokit(): Octokit {
  return pickClient('core').octokit;
}

// The "dashboard owner" is whoever owns the most recently added PAT
// (last entry in GITHUB_PATS). Resolved once at startup, cached for the lifetime of the process.
function getLatestPatClient(): PatClient | null {
  return clients.length > 0 ? clients[clients.length - 1] : null;
}

let cachedMinerLogin: string | null = null;
let minerLoginInFlight: Promise<string> | null = null;

export async function resolveMinerLogin(): Promise<string> {
  if (cachedMinerLogin) return cachedMinerLogin;
  if (minerLoginInFlight) return minerLoginInFlight;
  const fallback = process.env.GITHUB_USERNAME?.trim() || 'max-passion';
  const latest = getLatestPatClient();
  if (!latest) {
    cachedMinerLogin = fallback;
    return fallback;
  }
  minerLoginInFlight = (async () => {
    try {
      const { data } = await latest.octokit.users.getAuthenticated();
      cachedMinerLogin = data.login;
      console.log(`[github] dashboard owner resolved as "${data.login}" (PAT ...${latest.tokenSuffix})`);
      return data.login;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[github] could not resolve dashboard owner from latest PAT: ${msg} — falling back to "${fallback}"`);
      cachedMinerLogin = fallback;
      return fallback;
    } finally {
      minerLoginInFlight = null;
    }
  })();
  return minerLoginInFlight;
}

export function getMinerLogin(): string {
  return cachedMinerLogin ?? (process.env.GITHUB_USERNAME?.trim() || 'max-passion');
}

if (clients.length > 0) {
  // Fire-and-forget at module init so the cached value is populated before most requests arrive.
  resolveMinerLogin().catch(() => {});
}

export function getLatestPatOctokit(): Octokit {
  const c = getLatestPatClient();
  if (!c) throw new Error('No GitHub PATs configured');
  return c.octokit;
}

export interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  state_reason: string | null;
  user: { login: string | null } | null;
  author_association: string;
  labels: Array<string | { name?: string; color?: string }>;
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  html_url: string;
  pull_request?: unknown;
}

export interface GhPull {
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  user: { login: string | null } | null;
  // GitHub's pull-request payload carries the same `author_association` field
  // as the issues payload (OWNER / COLLABORATOR / CONTRIBUTOR / MEMBER /
  // FIRST_TIMER / FIRST_TIME_CONTRIBUTOR / MANNEQUIN / NONE).
  author_association: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  html_url: string;
}

// Cap pages on a single fetch. Sized to capture the largest known repo
// (openclaw/openclaw, ~31k issues + ~39k PRs = ~310/390 pages) with headroom.
// Bump this in tandem with BOOTSTRAP_VERSION in refresh.ts so existing repos
// re-bootstrap with the new cap.
const MAX_BOOTSTRAP_PAGES = 500;

export async function fetchIssuesFromGithub(
  owner: string,
  repo: string,
  sinceIso?: string,
  perPage = 100,
): Promise<GhIssue[]> {
  return withRotation(async (octokit) => {
    const out: GhIssue[] = [];
    const maxPages = sinceIso ? 200 : MAX_BOOTSTRAP_PAGES;
    for (let page = 1; page <= maxPages; page++) {
      const resp = await octokit.issues.listForRepo({
        owner,
        repo,
        state: 'all',
        per_page: perPage,
        sort: 'updated',
        direction: 'desc',
        page,
        ...(sinceIso ? { since: sinceIso } : {}),
      });
      const items = resp.data as unknown as Array<GhIssue & { pull_request?: unknown }>;
      if (items.length === 0) break;
      for (const raw of items) {
        if (raw.pull_request) continue;
        out.push(raw);
      }
      if (items.length < perPage) break;
    }
    return out;
  });
}

export async function fetchPullsFromGithub(
  owner: string,
  repo: string,
  sinceIso?: string,
  perPage = 100,
): Promise<GhPull[]> {
  return withRotation(async (octokit) => {
    const out: GhPull[] = [];
    const sinceMs = sinceIso ? new Date(sinceIso).getTime() : 0;
    const maxPages = sinceIso ? 200 : MAX_BOOTSTRAP_PAGES;
    for (let page = 1; page <= maxPages; page++) {
      const resp = await octokit.pulls.list({
        owner,
        repo,
        state: 'all',
        per_page: perPage,
        sort: 'updated',
        direction: 'desc',
        page,
      });
      const items = resp.data as unknown as GhPull[];
      if (items.length === 0) break;
      let stop = false;
      for (const pr of items) {
        if (sinceMs && new Date(pr.updated_at).getTime() < sinceMs) {
          stop = true;
          break;
        }
        out.push(pr);
      }
      if (stop || items.length < perPage) break;
    }
    return out;
  });
}

/**
 * Asks GitHub's GraphQL API for the authoritative list of PRs linked to an
 * issue — covers both the "closes/fixes #N" body-keyword case AND the manual
 * Development-sidebar linking that the regex extractor can't see.
 *
 * Returns an array of PR numbers in the same repo. Cross-repo references are
 * dropped (the dashboard's per-repo views can't render them anyway).
 */
export async function fetchIssueLinkedPrs(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<number[]> {
  return withRotation(async (octokit) => {
    interface PRRef { number: number; }
    interface QueryShape {
      repository?: {
        issue?: {
          closedByPullRequestsReferences?: { nodes: Array<PRRef | null> | null } | null;
          timelineItems?: {
            nodes: Array<
              | { __typename: 'ConnectedEvent'; subject: { number?: number; __typename?: string } | null }
              | { __typename: 'CrossReferencedEvent'; isCrossRepository: boolean; source: { number?: number; __typename?: string } | null }
              | null
            > | null;
          } | null;
        } | null;
      } | null;
    }
    const data = await octokit.graphql<QueryShape>(
      `query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            closedByPullRequestsReferences(first: 50, includeClosedPrs: true) {
              nodes { number }
            }
            timelineItems(itemTypes: [CONNECTED_EVENT, CROSS_REFERENCED_EVENT], first: 50) {
              nodes {
                __typename
                ... on ConnectedEvent {
                  subject { __typename ... on PullRequest { number } }
                }
                ... on CrossReferencedEvent {
                  isCrossRepository
                  source { __typename ... on PullRequest { number } }
                }
              }
            }
          }
        }
      }`,
      { owner, repo, number: issueNumber },
    );
    const nums = new Set<number>();
    const issue = data.repository?.issue;
    for (const n of issue?.closedByPullRequestsReferences?.nodes ?? []) {
      if (n?.number) nums.add(n.number);
    }
    for (const item of issue?.timelineItems?.nodes ?? []) {
      if (!item) continue;
      if (item.__typename === 'ConnectedEvent' && item.subject?.__typename === 'PullRequest') {
        if (item.subject.number) nums.add(item.subject.number);
      }
      if (
        item.__typename === 'CrossReferencedEvent' &&
        !item.isCrossRepository &&
        item.source?.__typename === 'PullRequest'
      ) {
        if (item.source.number) nums.add(item.source.number);
      }
    }
    return [...nums];
  });
}

/**
 * Batch query: for up to ~50 PR numbers in a single repo, return each PR's
 * `closingIssuesReferences` (the GraphQL field that captures both keyword
 * `closes #N` AND manual Development-sidebar links). Same-repo references
 * only — cross-repo closes aren't tracked by the per-repo dashboard.
 */
export async function fetchPrsClosingIssuesBatch(
  owner: string,
  repo: string,
  prNumbers: number[],
): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  if (prNumbers.length === 0) return out;
  return withRotation(async (octokit) => {
    interface PrNode {
      closingIssuesReferences?: {
        nodes: Array<{
          number: number;
          repository: { nameWithOwner: string };
        } | null> | null;
      } | null;
    }
    const fields = prNumbers
      .map(
        (n) =>
          `p${n}: pullRequest(number: ${n}) {
             closingIssuesReferences(first: 20, userLinkedOnly: false) {
               nodes { number repository { nameWithOwner } }
             }
           }`,
      )
      .join('\n');
    const query = `query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        ${fields}
      }
    }`;
    const data = await octokit.graphql<{
      repository?: Record<string, PrNode | null>;
    }>(query, { owner, repo });
    const fullName = `${owner}/${repo}`.toLowerCase();
    for (const n of prNumbers) {
      const pr = data.repository?.[`p${n}`];
      const refs = pr?.closingIssuesReferences?.nodes ?? [];
      const issueNums: number[] = [];
      for (const r of refs) {
        if (!r) continue;
        if (r.repository?.nameWithOwner?.toLowerCase() !== fullName) continue;
        if (Number.isFinite(r.number)) issueNums.push(r.number);
      }
      out.set(n, issueNums);
    }
    return out;
  });
}

export interface GhComment {
  id: number;
  user: { login: string } | null;
  author_association: string;
  body: string | null;
  html_url: string;
  issue_url: string; // .../issues/{number}
  created_at: string;
  updated_at: string;
}

/**
 * Lists every issue/PR comment in a repo (GitHub treats PR conversation
 * comments as issue comments). With `sinceIso` we incrementally pull the
 * delta; without it, we paginate up to MAX_BOOTSTRAP_PAGES on first ingest.
 */
export async function fetchIssueCommentsFromGithub(
  owner: string,
  repo: string,
  sinceIso?: string,
  perPage = 100,
): Promise<GhComment[]> {
  return withRotation(async (octokit) => {
    const out: GhComment[] = [];
    const maxPages = sinceIso ? 200 : MAX_BOOTSTRAP_PAGES;
    for (let page = 1; page <= maxPages; page++) {
      const resp = await octokit.issues.listCommentsForRepo({
        owner,
        repo,
        per_page: perPage,
        sort: 'updated',
        direction: 'desc',
        page,
        ...(sinceIso ? { since: sinceIso } : {}),
      });
      const items = resp.data as unknown as GhComment[];
      if (items.length === 0) break;
      out.push(...items);
      if (items.length < perPage) break;
    }
    return out;
  });
}

export interface RateLimitStatus {
  index: number;
  tokenSuffix: string;
  cooldownUntil: number;
  lastError: string | null;
  core: { remaining: number; limit: number; resetAt: number };
  search: { remaining: number; limit: number; resetAt: number };
}

export function getAllRateLimitStatus(): RateLimitStatus[] {
  return clients.map((c) => ({
    index: c.index,
    tokenSuffix: c.tokenSuffix,
    cooldownUntil: c.cooldownUntil,
    lastError: c.lastError,
    core: { remaining: c.coreRemaining, limit: c.coreLimit, resetAt: c.coreResetAt },
    search: { remaining: c.searchRemaining, limit: c.searchLimit, resetAt: c.searchResetAt },
  }));
}

export async function fetchRateLimit() {
  // Aggregate across all PATs so the existing /api/rate-limit endpoint reflects total budget
  let remaining = 0;
  let limit = 0;
  let earliestReset = Infinity;
  for (const c of clients) {
    try {
      const { data } = await c.octokit.rateLimit.get();
      remaining += data.rate.remaining;
      limit += data.rate.limit;
      if (data.rate.reset < earliestReset) earliestReset = data.rate.reset;
    } catch {
      // skip clients that are unreachable
    }
  }
  return {
    limit,
    remaining,
    reset: Number.isFinite(earliestReset) ? earliestReset : Math.floor(Date.now() / 1000) + 3600,
    used: limit - remaining,
    pat_count: clients.length,
  };
}
