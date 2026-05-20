/**
 * Canonical client-facing DTOs for the entities the dashboard renders.
 *
 * Every API route that returns one of these shapes — and every client that
 * consumes it — imports from this file, so the wire contract has exactly
 * one definition. Per-endpoint shape variants are kept as separate types
 * (e.g. {@link Sn74Repo} vs {@link GtRepo} vs {@link GtRepoSummary}) because
 * different endpoints return genuinely different fields; collapsing them
 * into one optional-everything union would erase the type safety this file
 * is meant to provide.
 *
 * Server-only row shapes (e.g. {@link IssueRow}, {@link PullRow} in
 * `src/lib/db.ts`) live elsewhere and are mapped to the DTOs below at the
 * API boundary.
 */

// ─── Repo ────────────────────────────────────────────────────────────────────

/**
 * SN74 master-list entry. Returned by `/api/sn74-repos` and used by the
 * sidebar / repo explorer.
 */
export interface Sn74Repo {
  fullName: string;
  owner: string;
  name: string;
  weight: number;
  /** Fraction of this repo's emission allocated to issue discovery. Null when unknown. */
  issueDiscoveryShare: number | null;
  /** Fraction of this repo's emission reserved for registered maintainers. Null when unknown. */
  maintainerCut: number | null;
  /** Fixed PR/issue base score override. Null when not configured or unknown. */
  fixedBaseScore: number | null;
  /** Open-PR count threshold before the excessive-PR penalty applies. Null when unknown. */
  excessivePrPenaltyThreshold: number | null;
  /** Open-issue count threshold before issue-discovery spam suppression applies. Null when unknown. */
  openIssueSpamThreshold: number | null;
  /** Minimum PR credibility required for PR rewards. Null when unknown. */
  minCredibility: number | null;
  /** Minimum issue credibility required for issue-discovery rewards. Null when unknown. */
  minIssueCredibility: number | null;
  /** Multiplier used when no configured scoring label matches. Null when unknown. */
  defaultLabelMultiplier: number | null;
  /** Whether scoring-label application is trusted for this repo. Null when unknown. */
  trustedLabelPipeline: boolean | null;
  /** Extra branch patterns accepted in addition to the repository default branch. Null when unknown. */
  additionalAcceptableBranches: string[] | null;
  /** Per-label score multipliers configured for this repo. Null when none or unknown. */
  labelMultipliers: Record<string, number> | null;
  /** SN74's authoritative "this repo is inactive" timestamp. Absent on active repos. */
  inactiveAt: string | null;
}

/**
 * Aggregated Gittensor repo row. Returned by `/api/gt/repositories`.
 * Carries cross-PR aggregates (totalScore, contributorCount, trending,
 * collateral) that aren't in the SN74 master list.
 */
export interface GtRepo {
  fullName: string;
  owner: string;
  name: string;
  weight: number;
  isActive: boolean;
  inactiveAt: string | null;
  totalScore: number;
  totalPrCount: number;
  mergedPrCount: number;
  contributorCount: number;
  collateralStaked: number;
  prsThisWeek: number;
  prsLastWeek: number;
  trendingPct: number;
  lastPrAt: string | null;
}

/** Recent-PR summary attached to the GtRepos response. */
export interface GtPrSummary {
  pullRequestNumber: number;
  title: string;
  repository: string;
  author: string;
  prCreatedAt: string;
  prState: string;
  mergedAt: string | null;
}

/** `/api/gt/repositories` response envelope. */
export interface GtReposResponse {
  fetched_at: number;
  source?: 'live' | 'cache' | 'stale';
  count: number;
  activeCount: number;
  inactiveCount: number;
  repos: GtRepo[];
  recentPrs: GtPrSummary[];
}

/**
 * Single-repo detail. Returned by `/api/gt/repos/[owner]/[name]`. Merges
 * Gittensor aggregates with live GitHub metadata.
 */
export interface GtRepoSummary {
  fullName: string;
  owner: string;
  name: string;
  weight: number | null;
  isActive: boolean;
  totalScore: number;
  mergedPrCount: number;
  contributorCount: number;
  closedIssueCount: number;
  github: GtRepoGithubMeta | null;
}

export interface GtRepoGithubMeta {
  description: string | null;
  isPrivate: boolean;
  defaultBranch: string;
  htmlUrl: string;
  stargazersCount: number;
  forksCount: number;
  openIssuesCount: number;
  license: string | null;
  topics: string[];
  pushedAt: string | null;
  createdAt: string | null;
}

/** Per-repo PR row. Returned by `/api/gt/repos/[owner]/[name]/prs`. */
export interface GtRepoPr {
  pullRequestNumber: number;
  title: string;
  author: string;
  githubId: string | null;
  avatarUrl: string;
  prState: 'OPEN' | 'MERGED' | 'CLOSED';
  prCreatedAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  commitCount: number;
  score: number;
  /** Parsed from a `#NNN ...` title prefix (Gittensor convention). */
  linkedIssueNumber: number | null;
}

export interface GtRepoPrsResponse {
  fullName: string;
  counts: { all: number; open: number; merged: number; closed: number };
  prs: GtRepoPr[];
  fetched_at: number;
}

/** Admin-managed extra repo. Returned by `/api/user-repos`. */
export interface UserRepo {
  full_name: string;
  weight: number;
  notes: string | null;
  added_at: string;
}

// ─── Miner ───────────────────────────────────────────────────────────────────

/**
 * Network-wide miner row. Returned by `/api/miners` (passthrough of
 * `https://api.gittensor.io/miners`).
 *
 * String numerics mirror upstream — many fields are decimal strings that
 * the dashboard parses lazily with a `num()` helper.
 */
export interface Miner {
  id: string;
  uid: number;
  hotkey: string;
  githubUsername: string;
  githubId?: string;
  isEligible: boolean;
  isIssueEligible?: boolean;
  failedReason?: string | null;
  credibility: string;
  issueCredibility?: string;
  issueDiscoveryScore?: string;
  issueTokenScore?: string;
  totalScore: string;
  baseTotalScore?: string;
  totalSolvedIssues?: number;
  totalValidSolvedIssues?: number;
  totalOpenIssues?: number;
  totalClosedIssues?: number;
  totalOpenPrs?: number;
  totalClosedPrs?: number;
  totalMergedPrs?: number;
  totalPrs?: number;
  totalAdditions?: number;
  totalDeletions?: number;
  uniqueReposCount?: number;
  alphaPerDay?: number;
  taoPerDay?: number;
  usdPerDay?: number;
}

export interface AuthorCredibility {
  credibility: number | null;
  issue_credibility: number | null;
  issue_discovery_disabled?: boolean;
}

export interface MinersResponse {
  count: number;
  fetched_at: number;
  source?: 'live' | 'cache' | 'stale';
  miners: Miner[];
}

/**
 * Per-repo contributor projection. Returned by
 * `/api/gt/repos/[owner]/[name]/miners`, used by the repo detail page to
 * show OSS contributors + issue discoverers for one repo.
 */
export interface RepoMiner {
  githubId: string;
  githubUsername: string;
  prCount: number;
  score: number;
  ossRank: number | null;
  avatarUrl: string;
}

export interface RepoMinersResponse {
  fullName: string;
  ossContributions: RepoMiner[];
  issueDiscoveries: RepoMiner[];
  fetched_at: number;
}

// ─── Issue ───────────────────────────────────────────────────────────────────

export interface Issue {
  id: number;
  repo_full_name: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  state_reason: string | null;
  author_login: string | null;
  author_association: string | null;
  labels: Array<{ name: string; color?: string }>;
  comments: number;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  html_url: string | null;
  fetched_at: string;
  first_seen_at: string;
  merged_pr_count?: number;
  author_credibility?: AuthorCredibility | null;
}

export interface IssueStateCounts {
  open: number;
  completed: number;
  not_planned: number;
  /**
   * Closed + state_reason='duplicate'. Gittensor rule treats these as not
   * solved, separate from the generic "closed (other)" bucket.
   */
  duplicate: number;
  closed: number;
  /** @deprecated use `closed` */
  closed_other: number;
}

export interface AuthorIssueStats {
  open: number;
  completed: number;
  not_planned: number;
  closed: number;
}

export interface AuthorOption {
  login: string;
  count: number;
  /**
   * Per-author state-bucket counts. Populated by `/issues-meta` when the
   * dropdown asks for the full list (`summary=1` omits these).
   */
  open?: number;
  completed?: number;
  not_planned?: number;
  closed?: number;
}

export interface IssuesResponse {
  repo: string;
  count: number;
  state_counts: IssueStateCounts;
  new_count?: number;
  last_fetch: string | null;
  last_error: string | null;
  issues: Issue[];
  /** Linked PRs (closes/fixes/sidebar-linked) for issues on this page only. */
  linked_prs_by_issue?: Record<
    number,
    Array<{
      number: number;
      title: string;
      state: string;
      draft: number;
      merged: number;
      author_login: string | null;
    }>
  >;
  /** Per-author OPEN/DONE/NP/CL counts for authors of issues on this page. */
  page_author_stats?: Record<string, AuthorIssueStats>;
  /** Per-user valid/invalid marks for issues on this page (only set when signed in). */
  user_validations?: Record<number, 'valid' | 'invalid'>;
}

export interface IssuesMetaResponse {
  repo: string;
  author_options: AuthorOption[];
  author_stats: Record<string, AuthorIssueStats>;
  total_authors: number;
  /**
   * Issue counts grouped by GitHub `author_association`. Powers the
   * "Collaborators" / "Contributors" pseudo-filters at the top of the
   * author dropdown.
   */
  assoc_counts?: { collaborator: number; contributor: number };
}

// ─── Pull ────────────────────────────────────────────────────────────────────

export interface Pull {
  id: number;
  repo_full_name: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: number;
  merged: number;
  author_login: string | null;
  author_association: string | null;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  merged_at: string | null;
  html_url: string | null;
  fetched_at: string;
  first_seen_at: string;
  score?: PullScore | null;
  author_credibility?: AuthorCredibility | null;
}

export interface PullScore {
  score: number | null;
  collateral_score: number | null;
}

export interface LinkedIssueReference {
  number: number;
  title: string;
  state: string;
  state_reason: string | null;
  author_login: string | null;
}

export interface PullStateCounts {
  open: number;
  draft: number;
  merged: number;
  closed: number;
}

export interface PullsResponse {
  repo: string;
  count: number;
  state_counts: PullStateCounts;
  new_count?: number;
  last_fetch: string | null;
  last_error: string | null;
  pulls: Pull[];
  /** Linked issues (closes/fixes/sidebar-linked) for PRs on this page only. */
  linked_issues_by_pull?: Record<string, LinkedIssueReference[]>;
}

export interface PullsMetaResponse {
  repo: string;
  author_options: AuthorOption[];
  mine_count?: number;
  total_authors: number;
}

export type PullStatus = 'open' | 'draft' | 'merged' | 'closed';

export function pullStatus(p: Pull): PullStatus {
  if (p.merged) return 'merged';
  if (p.draft) return 'draft';
  if (p.state === 'open') return 'open';
  return 'closed';
}
