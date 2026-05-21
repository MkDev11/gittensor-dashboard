import { NextResponse } from 'next/server';
import { getReadDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const MINERS_URL = 'https://api.gittensor.io/miners';
const PRS_URL = 'https://api.gittensor.io/prs';
// Fresh window. Beyond this we still return cached data and refresh in the
// background (stale-while-revalidate) so requests never wait on a slow
// upstream once anything is cached.
const TTL_MS = 30_000;
const MINER_TTL_MS = 300_000;

export interface RepoEvaluation {
  repo: string;
  isEligible: boolean;
  isIssueEligible: boolean;
  credibility: number;
  issueCredibility: number;
  totalMergedPrs: number;
  totalClosedPrs: number;
  totalValidSolvedIssues: number;
  totalSolvedIssues: number;
  totalClosedIssues: number;
  totalOpenIssues: number;
  totalScore: number;
  issueDiscoveryScore: number;
}

interface PerMinerRaw {
  lifetimeAlpha?: number;
  lifetimeTao?: number;
  lifetimeUsd?: number;
  repositories?: Array<{
    repositoryFullName: string;
    isEligible: boolean;
    isIssueEligible: boolean;
    credibility: string | number;
    issueCredibility: string | number;
    totalMergedPrs: number;
    totalClosedPrs: number;
    totalValidSolvedIssues: number;
    totalSolvedIssues: number;
    totalClosedIssues: number;
    totalOpenIssues: number;
    totalScore: string | number;
    issueDiscoveryScore: string | number;
  }>;
}

interface PerMinerData {
  lifetimeAlpha?: number;
  lifetimeTao?: number;
  lifetimeUsd?: number;
  repoEvals: RepoEvaluation[];
}

const perMinerCache = new Map<string, { fetched_at: number; data: PerMinerData }>();
const perMinerInFlight = new Map<string, Promise<PerMinerData>>();

async function refreshPerMiner(githubId: string): Promise<PerMinerData> {
  try {
    const raw = await fetchJson<PerMinerRaw>(`${MINERS_URL}/${githubId}`);
    const repoEvals: RepoEvaluation[] = (raw.repositories ?? [])
      .filter((r) => r.repositoryFullName)
      .map((r) => ({
        repo: r.repositoryFullName,
        isEligible: !!r.isEligible,
        isIssueEligible: !!r.isIssueEligible,
        credibility: num(r.credibility),
        issueCredibility: num(r.issueCredibility),
        totalMergedPrs: r.totalMergedPrs ?? 0,
        totalClosedPrs: r.totalClosedPrs ?? 0,
        totalValidSolvedIssues: r.totalValidSolvedIssues ?? 0,
        totalSolvedIssues: r.totalSolvedIssues ?? 0,
        totalClosedIssues: r.totalClosedIssues ?? 0,
        totalOpenIssues: r.totalOpenIssues ?? 0,
        totalScore: num(r.totalScore),
        issueDiscoveryScore: num(r.issueDiscoveryScore),
      }));
    const data: PerMinerData = {
      lifetimeAlpha: raw.lifetimeAlpha,
      lifetimeTao: raw.lifetimeTao,
      lifetimeUsd: raw.lifetimeUsd,
      repoEvals,
    };
    perMinerCache.set(githubId, { fetched_at: Date.now(), data });
    return data;
  } catch {
    const hit = perMinerCache.get(githubId);
    return hit?.data ?? { repoEvals: [] };
  }
}

// Stale-while-revalidate: any cache returns instantly; stale entries
// trigger a background refresh so the next request is fresh.
async function fetchPerMiner(githubId: string): Promise<PerMinerData> {
  const now = Date.now();
  const hit = perMinerCache.get(githubId);
  if (hit) {
    if (now - hit.fetched_at >= MINER_TTL_MS && !perMinerInFlight.has(githubId)) {
      const p = refreshPerMiner(githubId).finally(() => perMinerInFlight.delete(githubId));
      perMinerInFlight.set(githubId, p);
    }
    return hit.data;
  }
  // Cold cache — must wait, but dedup concurrent first-hits.
  let p = perMinerInFlight.get(githubId);
  if (!p) {
    p = refreshPerMiner(githubId).finally(() => perMinerInFlight.delete(githubId));
    perMinerInFlight.set(githubId, p);
  }
  return p;
}

interface UpstreamMiner {
  uid: number;
  hotkey: string;
  githubUsername: string | null;
  githubId?: string | null;
  failedReason?: string | null;
  baseTotalScore?: number | string | null;
  totalScore?: number | string | null;
  totalCollateralScore?: number | string | null;
  totalOpenPrs?: number;
  totalClosedPrs?: number;
  totalMergedPrs?: number;
  totalPrs?: number;
  uniqueReposCount?: number;
  isEligible?: boolean;
  credibility?: number | string | null;
  eligibleRepoCount?: number;
  issueDiscoveryScore?: number | string | null;
  issueTokenScore?: number | string | null;
  issueCredibility?: number | string | null;
  isIssueEligible?: boolean;
  issueEligibleRepoCount?: number;
  totalSolvedIssues?: number;
  totalValidSolvedIssues?: number;
  totalClosedIssues?: number;
  totalOpenIssues?: number;
  evaluatedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  totalAdditions?: number;
  totalDeletions?: number;
  metagraphRank?: number;
  metagraphTrust?: number;
  metagraphConsensus?: number;
  metagraphIncentive?: number;
  metagraphEmission?: number;
  alphaPerDay?: number;
  taoPerDay?: number;
  usdPerDay?: number;
  lifetimeAlpha?: number;
  lifetimeTao?: number;
  lifetimeUsd?: number;
}

interface UpstreamPr {
  pullRequestNumber: number;
  hotkey: string;
  pullRequestTitle: string;
  additions?: number | null;
  deletions?: number | null;
  commitCount?: number | null;
  label?: string | null;
  repository: string;
  mergedAt: string | null;
  prCreatedAt: string;
  author?: string | null;
  githubId?: string | null;
  score?: string | number | null;
  baseScore?: string | number | null;
  collateralScore?: string | number | null;
  prState?: string;
  tokenScore?: string | number | null;
  potentialScore?: number | string | null;
  predictedAlphaPerDay?: number | null;
  predictedTaoPerDay?: number | null;
  predictedUsdPerDay?: number | null;
  reviewQualityMultiplier?: string | number | null;
  labelMultiplier?: string | number | null;
  codeDensity?: string | number | null;
  timeDecayMultiplier?: string | number | null;
  earnedScore?: string | number | null;
}

interface Cached {
  fetched_at: number;
  miners: UpstreamMiner[];
  prs: UpstreamPr[];
}

let cache: Cached | null = null;
let inFlight: Promise<Cached> | null = null;

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`upstream ${url} ${r.status}`);
  return (await r.json()) as T;
}

async function refresh(): Promise<Cached> {
  const [miners, prs] = await Promise.all([
    fetchJson<UpstreamMiner[]>(MINERS_URL),
    fetchJson<UpstreamPr[]>(PRS_URL),
  ]);
  const next: Cached = { fetched_at: Date.now(), miners, prs };
  cache = next;
  return next;
}

// Stale-while-revalidate: return cached immediately, refresh stale in background.
async function getShared(): Promise<Cached> {
  const now = Date.now();
  if (cache) {
    if (now - cache.fetched_at >= TTL_MS && !inFlight) {
      inFlight = refresh().catch(() => cache!).finally(() => { inFlight = null; });
    }
    return cache;
  }
  if (!inFlight) inFlight = refresh().finally(() => { inFlight = null; });
  return inFlight;
}

function derivedPrState(p: UpstreamPr): 'OPEN' | 'MERGED' | 'CLOSED' {
  if (p.mergedAt) return 'MERGED';
  if ((p.prState ?? '').toUpperCase() === 'CLOSED') return 'CLOSED';
  return 'OPEN';
}

/* Issue lifecycle bucket used by the detail page.
 *
 *  - 'solved'   : closed by a merged PR (proven outcome via pr_issue_links).
 *  - 'completed': closed with reason=completed but no merged PR linked yet
 *                 (GitHub marked it done; the close path isn't tracked).
 *  - 'open'     : still open.
 *  - 'closed'   : closed with not_planned / duplicate / no completion proof. */
export type IssueBucket = 'solved' | 'completed' | 'open' | 'closed';

export interface MinerPrDetail {
  pullRequestNumber: number;
  title: string;
  repository: string;
  prState: 'OPEN' | 'MERGED' | 'CLOSED';
  prCreatedAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  commitCount: number;
  label: string | null;
  // Actual reward score (often 0 when not eligible / not yet merged).
  score: number;
  // Real intrinsic score (potential / base — what the PR is worth).
  realScore: number;
  collateralScore: number;
  predictedUsdPerDay: number;
  timeDecayMultiplier: number | null;
  earnedScore: number | null;
  // Validator's token score — used to determine if a PR counts as "valid" for eligibility (threshold: >= 5).
  tokenScore: number;
  // Comma-joined "#N, #M" of issues this PR closed (via pr_issue_links).
  // Null when no linked issues are recorded in the local DB.
  linkedIssues: string | null;
}

/* Two flavours of "issue" the page surfaces per miner:
 *  - discovered: issue authored by this miner's GitHub login (the
 *    Gittensor "Issue Discovery" track rewards finding & posting issues).
 *  - solved:     issue closed by one of this miner's merged PRs (via
 *    pr_issue_links). These are separate populations and the page shows
 *    them side-by-side.
 */
export interface MinerIssueDetail {
  repo: string;
  number: number;
  title: string;
  state: string;
  stateReason: string | null;
  htmlUrl: string | null;
  createdAt: string | null;
  closedAt: string | null;
  comments: number;
  bucket: IssueBucket;
  // Comma-joined "#N, #M" of merged PRs this miner authored that closed
  // this issue (solved set only). Null on discovered-without-merge.
  closedByPrs: string | null;
}

export interface MinerDetailResp {
  miner: UpstreamMiner;
  prs: MinerPrDetail[];
  discoveredIssues: MinerIssueDetail[];
  solvedIssues: MinerIssueDetail[];
  repoEvals: RepoEvaluation[];
  fetched_at: number;
}

export async function GET(_req: Request, ctx: { params: Promise<{ uid: string }> }) {
  const { uid: uidParam } = await ctx.params;
  const uid = Number.parseInt(uidParam, 10);
  if (!Number.isFinite(uid)) {
    return NextResponse.json({ error: 'Invalid uid' }, { status: 400 });
  }
  try {
    const shared = await getShared();
    const miner = shared.miners.find((m) => m.uid === uid);
    if (!miner) {
      return NextResponse.json({ error: 'Miner not found' }, { status: 404 });
    }

    const ghIdKey = miner.githubId ? String(miner.githubId) : null;
    const ghUserKey = miner.githubUsername ? miner.githubUsername.toLowerCase() : null;
    const hotkeyKey = miner.hotkey;

    // Kick off the per-miner upstream fetch — runs concurrently with the
    // PR mapping and DB queries below.
    const perMinerP: Promise<PerMinerData> = ghIdKey
      ? fetchPerMiner(ghIdKey)
      : Promise.resolve({ repoEvals: [] });

    // Build a (repo, pr_number) → "#N, #M" map of linked issues so each PR
    // can show what it closes. Scoped to this miner's PRs by author_login,
    // so the result set is bounded and indexable.
    const prLinkedIssues = new Map<string, string>();
    if (ghUserKey) {
      const db = getReadDb();
      type LinkRow = { repo_full_name: string; pr_number: number; issue_numbers: string | null };
      const rows = db
        .prepare(
          `SELECT l.repo_full_name, l.pr_number,
                  GROUP_CONCAT(DISTINCT l.issue_number) AS issue_numbers
           FROM pr_issue_links l
           JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
           WHERE LOWER(p.author_login) = LOWER(?)
           GROUP BY l.repo_full_name, l.pr_number`,
        )
        .all(ghUserKey) as LinkRow[];
      for (const r of rows) {
        if (!r.issue_numbers) continue;
        const key = `${r.repo_full_name.toLowerCase()}#${r.pr_number}`;
        const formatted = r.issue_numbers.split(',').map((n) => `#${n.trim()}`).join(', ');
        prLinkedIssues.set(key, formatted);
      }
    }

    const prs: MinerPrDetail[] = shared.prs
      .filter((p) => {
        if (ghIdKey && p.githubId && String(p.githubId) === ghIdKey) return true;
        if (ghUserKey && p.author && p.author.toLowerCase() === ghUserKey) return true;
        if (hotkeyKey && p.hotkey === hotkeyKey) return true;
        return false;
      })
      .map((p) => ({
        pullRequestNumber: p.pullRequestNumber,
        title: p.pullRequestTitle,
        repository: p.repository,
        prState: derivedPrState(p),
        prCreatedAt: p.prCreatedAt,
        mergedAt: p.mergedAt,
        additions: p.additions ?? 0,
        deletions: p.deletions ?? 0,
        commitCount: p.commitCount ?? 0,
        label: p.label ?? null,
        score: num(p.score),
        realScore: num(p.potentialScore ?? p.baseScore),
        collateralScore: num(p.collateralScore),
        predictedUsdPerDay: num(p.predictedUsdPerDay),
        timeDecayMultiplier: p.timeDecayMultiplier != null ? num(p.timeDecayMultiplier) : null,
        earnedScore: p.earnedScore != null ? num(p.earnedScore) : null,
        tokenScore: num(p.tokenScore),
        linkedIssues: prLinkedIssues.get(`${p.repository.toLowerCase()}#${p.pullRequestNumber}`) ?? null,
      }))
      .sort((a, b) => (Date.parse(b.prCreatedAt) || 0) - (Date.parse(a.prCreatedAt) || 0));

    // Local-DB lookups: discovered + solved issues. These rely on the
    // GitHub-side cache populated by the poller. If the DB hasn't ingested
    // a repo yet, those issues just won't appear — the miner's upstream
    // aggregates (totalSolvedIssues etc.) on the response still reflect
    // ground truth.
    let discoveredIssues: MinerIssueDetail[] = [];
    let solvedIssues: MinerIssueDetail[] = [];

    if (ghUserKey) {
      const db = getReadDb();

      type DiscoveredRow = {
        repo_full_name: string;
        number: number;
        title: string;
        state: string;
        state_reason: string | null;
        html_url: string | null;
        created_at: string | null;
        closed_at: string | null;
        comments: number;
        merged_pr_count: number;
        merged_pr_numbers: string | null;
      };

      const discovered = db
        .prepare(
          `SELECT i.repo_full_name, i.number, i.title, i.state, i.state_reason,
                  i.html_url, i.created_at, i.closed_at, i.comments,
                  (SELECT COUNT(*) FROM pr_issue_links l
                    JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
                    WHERE l.repo_full_name = i.repo_full_name AND l.issue_number = i.number AND p.merged = 1) AS merged_pr_count,
                  (SELECT GROUP_CONCAT(DISTINCT p.number) FROM pr_issue_links l
                    JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
                    WHERE l.repo_full_name = i.repo_full_name AND l.issue_number = i.number AND p.merged = 1) AS merged_pr_numbers
           FROM issues i
           WHERE LOWER(i.author_login) = LOWER(?)
           ORDER BY COALESCE(i.created_at, '') DESC
           LIMIT 500`,
        )
        .all(ghUserKey) as DiscoveredRow[];

      discoveredIssues = discovered.map((r) => {
        const reason = (r.state_reason ?? '').toUpperCase();
        let bucket: IssueBucket;
        if (r.state === 'open') bucket = 'open';
        else if (reason === 'COMPLETED' && r.merged_pr_count > 0) bucket = 'solved';
        else if (reason === 'COMPLETED') bucket = 'completed';
        else bucket = 'closed';
        const closedByPrs = r.merged_pr_numbers
          ? r.merged_pr_numbers.split(',').map((n) => `#${n.trim()}`).join(', ')
          : null;
        return {
          repo: r.repo_full_name,
          number: r.number,
          title: r.title,
          state: r.state,
          stateReason: r.state_reason,
          htmlUrl: r.html_url,
          createdAt: r.created_at,
          closedAt: r.closed_at,
          comments: r.comments,
          bucket,
          closedByPrs,
        };
      });

      // Solved set: issues closed by a merged PR this miner authored.
      // Group merged PR numbers per issue so the row can show "#42, #57".
      type SolvedRow = {
        repo_full_name: string;
        number: number;
        title: string;
        state: string;
        state_reason: string | null;
        html_url: string | null;
        created_at: string | null;
        closed_at: string | null;
        comments: number;
        pr_numbers: string | null;
      };
      const solved = db
        .prepare(
          `SELECT i.repo_full_name, i.number, i.title, i.state, i.state_reason,
                  i.html_url, i.created_at, i.closed_at, i.comments,
                  GROUP_CONCAT(DISTINCT p.number) AS pr_numbers
           FROM issues i
           JOIN pr_issue_links l ON l.repo_full_name = i.repo_full_name AND l.issue_number = i.number
           JOIN pulls p ON p.repo_full_name = l.repo_full_name AND p.number = l.pr_number
           WHERE p.merged = 1 AND LOWER(p.author_login) = LOWER(?)
           GROUP BY i.repo_full_name, i.number
           ORDER BY COALESCE(i.closed_at, i.updated_at, i.created_at, '') DESC
           LIMIT 500`,
        )
        .all(ghUserKey) as SolvedRow[];

      solvedIssues = solved.map((r) => {
        const reason = (r.state_reason ?? '').toUpperCase();
        let bucket: IssueBucket;
        if (r.state === 'open') bucket = 'open';
        else if (reason === 'COMPLETED') bucket = 'solved';
        else bucket = 'closed';
        const prs = r.pr_numbers
          ? r.pr_numbers
              .split(',')
              .map((n) => `#${n}`)
              .join(', ')
          : null;
        return {
          repo: r.repo_full_name,
          number: r.number,
          title: r.title,
          state: r.state,
          stateReason: r.state_reason,
          htmlUrl: r.html_url,
          createdAt: r.created_at,
          closedAt: r.closed_at,
          comments: r.comments,
          bucket,
          closedByPrs: prs,
        };
      });
    }

    // Await the per-miner fetch we kicked off above. With stale-while-
    // revalidate this is usually instant (cache hit) and only blocks on a
    // truly cold cache.
    const { repoEvals, ...lifetimeFields } = await perMinerP;
    const minerWithLifetime = { ...miner, ...lifetimeFields };

    const resp: MinerDetailResp = {
      miner: minerWithLifetime,
      prs,
      discoveredIssues,
      solvedIssues,
      repoEvals,
      fetched_at: shared.fetched_at,
    };
    return NextResponse.json(resp);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
