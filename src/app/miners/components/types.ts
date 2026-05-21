// Miners feature data shapes. Derivations in ./helpers, tokens in ./tokens.
export interface MinerTopRepo {
  name: string;
  count: number;
}

export interface Miner {
  id: string;
  uid: number;
  hotkey: string;
  githubUsername: string | null;
  githubId?: string;
  isEligible: boolean;
  isIssueEligible?: boolean;
  failedReason?: string | null;
  credibility: string;
  issueCredibility?: string;
  eligibleRepoCount?: number;
  issueEligibleRepoCount?: number;
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
  // Server-enriched: merged PRs with tokenScore >= 5.
  totalValidMergedPrs?: number;
  lastOssActivityAt?: string | null;
  lastDiscoveryActivityAt?: string | null;
  totalPrs?: number;
  totalAdditions?: number;
  totalDeletions?: number;
  uniqueReposCount?: number;
  alphaPerDay?: number;
  taoPerDay?: number;
  usdPerDay?: number;
  // Upstream timestamp from the validator's miner record. Equals `evaluatedAt`
  // (not a reliable registration time — the row gets re-indexed by the validator).
  createdAt?: string;
  // Server-enriched: PR-count buckets for the validator's PR_LOOKBACK_DAYS
  // window, oldest→newest. Length equals PR_LOOKBACK_DAYS.
  dailyLookback?: number[];
  topRepos?: MinerTopRepo[];
  // Server-enriched: rank held at the start of the previous UTC day.
  previousRank?: number | null;
}

export type Mode = 'total' | 'oss' | 'discovery';

export interface MinerView {
  mode: Mode;
  score: number;
  cred: number;
  eligible: boolean;
  usd: number;
  counts: {
    primaryLabel: 'Merged' | 'Solved' | 'Done';
    primary: number;
    open: number;
    closed: number;
  };
}

// Semantic tone names; CSS values in ./tokens.
export type Tone = 'neutral' | 'success' | 'danger' | 'done' | 'accent';
