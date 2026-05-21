export interface RepoEligibilityConfig {
  minValidMergedPrs: number | null;
  minCredibility: number | null;
  minTokenScoreForBaseScore: number | null;
  excessivePrPenaltyBaseThreshold: number | null;
  openPrThresholdTokenScore: number | null;
  maxOpenPrThreshold: number | null;
  minValidSolvedIssues: number | null;
  minIssueCredibility: number | null;
  minTokenScoreForValidIssue: number | null;
  openIssueSpamBaseThreshold: number | null;
  openIssueSpamTokenScorePerSlot: number | null;
  maxOpenIssueThreshold: number | null;
}

export interface RepoTimeDecayConfig {
  gracePeriodHours: number;
  sigmoidMidpointDays: number;
  sigmoidSteepness: number;
  minMultiplier: number;
}

export interface RepoScoringConfig {
  prLookbackDays: number;
  openPrCollateralPercent: number;
  reviewPenaltyRate: number;
  standardIssueMultiplier: number;
  maintainerIssueMultiplier: number;
  timeDecay: RepoTimeDecayConfig;
}

export interface RepoEntry {
  fullName: string;
  owner: string;
  name: string;
  /** Backward-compatible alias for the repo's SN74 emission_share. */
  weight: number;
  emissionShare: number;
  issueDiscoveryShare: number;
  maintainerCut: number;
  fixedBaseScore: number | null;
  labelMultipliers: Record<string, number>;
  defaultLabelMultiplier: number;
  trustedLabelPipeline: boolean;
  additionalAcceptableBranches: string[];
  eligibility: RepoEligibilityConfig;
  scoring: RepoScoringConfig;
  excessivePrPenaltyThreshold: number | null;
  openIssueSpamThreshold: number | null;
  minCredibility: number | null;
  minIssueCredibility: number | null;
  /**
   * SN74's authoritative "this repo is inactive" timestamp. Set by the
   * Gittensor validator team in master_repositories.json when a repo is
   * deprioritised - miners earn no rewards from inactive repos. Absent on
   * active repos.
   */
  inactiveAt: string | null;
}

export type Sn74Repo = RepoEntry;

/**
 * Empty by design - the bundled `master_repositories.json` is no longer
 * consulted. Live data flows from `/api/sn74-repos` (server-side) into
 * client components via `useSn74Repos()`. Anything that imported this for
 * a synchronous initial value now just gets an empty list until the live
 * fetch lands; render an empty/loading state accordingly.
 */
export const ALL_REPOS: Sn74Repo[] = [];

const EMPTY_ELIGIBILITY: RepoEligibilityConfig = {
  minValidMergedPrs: null,
  minCredibility: null,
  minTokenScoreForBaseScore: null,
  excessivePrPenaltyBaseThreshold: null,
  openPrThresholdTokenScore: null,
  maxOpenPrThreshold: null,
  minValidSolvedIssues: null,
  minIssueCredibility: null,
  minTokenScoreForValidIssue: null,
  openIssueSpamBaseThreshold: null,
  openIssueSpamTokenScorePerSlot: null,
  maxOpenIssueThreshold: null,
};

export const DEFAULT_SCORING: RepoScoringConfig = {
  prLookbackDays: 30,
  openPrCollateralPercent: 0.2,
  reviewPenaltyRate: 0.15,
  standardIssueMultiplier: 1.33,
  maintainerIssueMultiplier: 1.66,
  timeDecay: {
    gracePeriodHours: 12,
    sigmoidMidpointDays: 10,
    sigmoidSteepness: 0.4,
    minMultiplier: 0.05,
  },
};

export function createRepoEntry(fullName: string, weight = 0, inactiveAt: string | null = null): RepoEntry {
  const [owner = '', name = ''] = fullName.split('/');
  return {
    fullName,
    owner,
    name,
    weight,
    emissionShare: weight,
    issueDiscoveryShare: 0.5,
    maintainerCut: 0,
    fixedBaseScore: null,
    labelMultipliers: {},
    defaultLabelMultiplier: 1,
    trustedLabelPipeline: false,
    additionalAcceptableBranches: [],
    eligibility: { ...EMPTY_ELIGIBILITY },
    scoring: { ...DEFAULT_SCORING, timeDecay: { ...DEFAULT_SCORING.timeDecay } },
    excessivePrPenaltyThreshold: null,
    openIssueSpamThreshold: null,
    minCredibility: null,
    minIssueCredibility: null,
    inactiveAt,
  };
}

export function weightBand(weight: number): {
  label: string;
  tone: 'success' | 'accent' | 'attention' | 'severe' | 'neutral';
} {
  if (weight >= 0.5) return { label: 'Flagship', tone: 'success' };
  if (weight >= 0.3) return { label: 'High', tone: 'accent' };
  if (weight >= 0.15) return { label: 'Mid-High', tone: 'attention' };
  if (weight >= 0.05) return { label: 'Standard', tone: 'neutral' };
  return { label: 'Low', tone: 'severe' };
}
