import type { RepoEntry, RepoEligibilityConfig } from './repos';

const OSS_SHARE = 0.9;

export interface ResolvedEligibility {
  minValidMergedPrs: number;
  minCredibility: number;
  minTokenScoreForBaseScore: number;
  excessivePrPenaltyBaseThreshold: number;
  openPrThresholdTokenScore: number;
  maxOpenPrThreshold: number;
  minValidSolvedIssues: number;
  minIssueCredibility: number;
  minTokenScoreForValidIssue: number;
  openIssueSpamBaseThreshold: number;
  openIssueSpamTokenScorePerSlot: number;
  maxOpenIssueThreshold: number;
}

export const DEFAULT_ELIGIBILITY: ResolvedEligibility = {
  minValidMergedPrs: 3,
  minCredibility: 0.8,
  minTokenScoreForBaseScore: 5,
  excessivePrPenaltyBaseThreshold: 2,
  openPrThresholdTokenScore: 300,
  maxOpenPrThreshold: 30,
  minValidSolvedIssues: 3,
  minIssueCredibility: 0.7,
  minTokenScoreForValidIssue: 5,
  openIssueSpamBaseThreshold: 2,
  openIssueSpamTokenScorePerSlot: 300,
  maxOpenIssueThreshold: 30,
};

export function resolveEligibility(input: RepoEligibilityConfig | null | undefined): ResolvedEligibility {
  return {
    minValidMergedPrs: input?.minValidMergedPrs ?? DEFAULT_ELIGIBILITY.minValidMergedPrs,
    minCredibility: input?.minCredibility ?? DEFAULT_ELIGIBILITY.minCredibility,
    minTokenScoreForBaseScore: input?.minTokenScoreForBaseScore ?? DEFAULT_ELIGIBILITY.minTokenScoreForBaseScore,
    excessivePrPenaltyBaseThreshold:
      input?.excessivePrPenaltyBaseThreshold ?? DEFAULT_ELIGIBILITY.excessivePrPenaltyBaseThreshold,
    openPrThresholdTokenScore: input?.openPrThresholdTokenScore ?? DEFAULT_ELIGIBILITY.openPrThresholdTokenScore,
    maxOpenPrThreshold: input?.maxOpenPrThreshold ?? DEFAULT_ELIGIBILITY.maxOpenPrThreshold,
    minValidSolvedIssues: input?.minValidSolvedIssues ?? DEFAULT_ELIGIBILITY.minValidSolvedIssues,
    minIssueCredibility: input?.minIssueCredibility ?? DEFAULT_ELIGIBILITY.minIssueCredibility,
    minTokenScoreForValidIssue: input?.minTokenScoreForValidIssue ?? DEFAULT_ELIGIBILITY.minTokenScoreForValidIssue,
    openIssueSpamBaseThreshold: input?.openIssueSpamBaseThreshold ?? DEFAULT_ELIGIBILITY.openIssueSpamBaseThreshold,
    openIssueSpamTokenScorePerSlot:
      input?.openIssueSpamTokenScorePerSlot ?? DEFAULT_ELIGIBILITY.openIssueSpamTokenScorePerSlot,
    maxOpenIssueThreshold: input?.maxOpenIssueThreshold ?? DEFAULT_ELIGIBILITY.maxOpenIssueThreshold,
  };
}

function boundedShare(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function repoScoringPool(repo: RepoEntry): number {
  const maintainerCut = boundedShare(repo.maintainerCut);
  return repo.emissionShare * OSS_SHARE * (1 - maintainerCut);
}

export function prPool(repo: RepoEntry): number {
  return repoScoringPool(repo) * (1 - boundedShare(repo.issueDiscoveryShare));
}

export function issuePool(repo: RepoEntry): number {
  return repoScoringPool(repo) * boundedShare(repo.issueDiscoveryShare);
}

export function bestLabelMultiplier(repo: RepoEntry): { label: string | null; multiplier: number } {
  const entries = Object.entries(repo.labelMultipliers ?? {});
  if (entries.length === 0) return { label: null, multiplier: repo.defaultLabelMultiplier || 1 };
  const [label, multiplier] = entries.sort((a, b) => b[1] - a[1])[0];
  return { label, multiplier };
}

export function labelSummary(repo: RepoEntry): string {
  const best = bestLabelMultiplier(repo);
  if (!best.label) return repo.defaultLabelMultiplier !== 1 ? repo.defaultLabelMultiplier.toFixed(2) + 'x default' : '1.00x';
  return best.label + ' ' + best.multiplier.toFixed(2) + 'x';
}

export function branchSummary(repo: RepoEntry): string {
  if (!repo.additionalAcceptableBranches.length) return 'default';
  return ['default', ...repo.additionalAcceptableBranches].join(', ');
}

export function pct(value: number): string {
  return (value * 100).toFixed(value >= 0.1 ? 1 : 2) + '%';
}

export function opportunityScore(
  repo: RepoEntry,
  stats?: { contributorCount?: number; totalScore?: number; prsThisWeek?: number },
): number {
  if (repo.inactiveAt || repo.emissionShare <= 0) return 0;
  const bestLabel = bestLabelMultiplier(repo).multiplier;
  const competition = 1 + Math.log1p(stats?.contributorCount ?? 0);
  const recentActivity = 1 + Math.min(0.5, (stats?.prsThisWeek ?? 0) * 0.03);
  const issueBalance = 1 + boundedShare(repo.issueDiscoveryShare) * 0.25;
  const labelLift = Math.max(0.25, bestLabel);
  return (repoScoringPool(repo) * labelLift * issueBalance * recentActivity) / competition;
}
