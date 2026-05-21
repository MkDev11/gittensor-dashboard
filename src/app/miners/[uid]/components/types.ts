// Feature-local — promote to src/types/entities.ts if consumed beyond the detail page.

export interface MinerProfile {
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
  alphaPerDay?: number;
  taoPerDay?: number;
  usdPerDay?: number;
  lifetimeAlpha?: number;
  lifetimeTao?: number;
  lifetimeUsd?: number;
  metagraphEmission?: number;
  metagraphIncentive?: number;
}

export interface PrDetail {
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
  score: number;
  realScore: number;
  collateralScore: number;
  predictedUsdPerDay: number;
  timeDecayMultiplier: number | null;
  earnedScore: number | null;
  tokenScore: number;
  linkedIssues: string | null; // comma-joined "#N, #M" of linked issues; null when none
}

export type IssueBucket = 'solved' | 'completed' | 'open' | 'closed';

export interface IssueDetail {
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
  closedByPrs: string | null;
}

export interface RepoEval {
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

export interface DetailResp {
  miner: MinerProfile;
  prs: PrDetail[];
  discoveredIssues: IssueDetail[];
  solvedIssues: IssueDetail[];
  repoEvals: RepoEval[];
  fetched_at: number;
}

export type Period = '1D' | '7D' | '35D' | 'ALL';
export type Mode = 'oss' | 'discovery';

export const PERIODS: { key: Period; label: string; days: number | null }[] = [
  { key: '1D',  label: '1D',  days: 1 },
  { key: '7D',  label: '7D',  days: 7 },
  { key: '35D', label: '35D', days: 35 },
  { key: 'ALL', label: 'All', days: null },
];

export interface RepoBucket {
  repo: string;
  prs: PrDetail[];
  merged: number;
  validPrs: number;
  predictedUsd: number;
  openPr: number;
  closedPr: number;
  realScore: number;
  additions: number;
  deletions: number;
  discovered: IssueDetail[];
  solvedByPr: IssueDetail[];
  openIssue: number;
  solvedIssue: number;
  completedIssue: number;
  closedIssue: number;
}

export function makeRepoBucket(repo: string): RepoBucket {
  return {
    repo,
    prs: [], merged: 0, validPrs: 0, openPr: 0, closedPr: 0,
    realScore: 0, additions: 0, deletions: 0, predictedUsd: 0,
    discovered: [], solvedByPr: [],
    openIssue: 0, solvedIssue: 0, completedIssue: 0, closedIssue: 0,
  };
}

export type SummaryTone = 'neutral' | 'success' | 'danger' | 'done' | 'accent';

export const SUMMARY_TONE_FG: Record<SummaryTone, string> = {
  neutral: 'var(--fg-default)',
  success: 'var(--success-fg)',
  danger:  'var(--danger-fg)',
  done:    'var(--done-fg)',
  accent:  'var(--accent-fg)',
};

export function withinPeriod(iso: string | null | undefined, days: number | null): boolean {
  if (days === null) return true;
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < days * 24 * 60 * 60 * 1000;
}
