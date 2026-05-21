import type { Miner, MinerView, Mode } from './types';

// Tolerant numeric coercion: scores come as decimal strings; garbage → 0, never NaN.
export function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

export function ghKey(name: string | null | undefined): string {
  return (name ?? '').toLowerCase();
}

export function ghName(m: Pick<Miner, 'githubUsername' | 'uid'>): string {
  return m.githubUsername || `uid-${m.uid}`;
}

export function ghAvatar(m: Pick<Miner, 'githubUsername' | 'uid'>, size: number): string {
  return `https://github.com/${ghName(m)}.png?size=${size}`;
}

// Splits usdPerDay between OSS and Discovery proportional to score, eligible tracks only.
export function splitEarnings(
  usdPerDay: number,
  ossScore: number,
  issueScore: number,
  ossEligible: boolean,
  issueEligible: boolean,
): { oss: number; disc: number } {
  const combined = ossScore + issueScore;
  let ossShare = 0;
  let discShare = 0;
  if (ossEligible && issueEligible) {
    ossShare = combined > 0 ? ossScore / combined : 0.5;
    discShare = 1 - ossShare;
  } else if (ossEligible) {
    ossShare = 1;
  } else if (issueEligible) {
    discShare = 1;
  }
  return { oss: usdPerDay * ossShare, disc: usdPerDay * discShare };
}

// Upstream `credibility` uses a weighted formula that can disagree with visible counts.
function acceptanceRate(positive: number, closed: number): number {
  const denom = positive + closed;
  return denom > 0 ? positive / denom : 0;
}

// All three modes share the same shape so callers can swap tracks without changing render code.
export function viewOf(m: Miner, mode: Mode): MinerView {
  const ossScore = num(m.totalScore);
  const issueScore = num(m.issueDiscoveryScore);
  const { oss: ossUsd, disc: discUsd } = splitEarnings(
    num(m.usdPerDay), ossScore, issueScore, !!m.isEligible, !!m.isIssueEligible,
  );

  const ossEligible = !!m.isEligible;
  const issueEligible = !!m.isIssueEligible;
  const combinedScore = ossScore + issueScore;

  const merged = m.totalMergedPrs ?? 0;
  const closedPr = m.totalClosedPrs ?? 0;
  const solved = m.totalSolvedIssues ?? 0;
  const closedIssue = m.totalClosedIssues ?? 0;
  const ossCred = acceptanceRate(merged, closedPr);
  const issueCred = acceptanceRate(solved, closedIssue);

  if (mode === 'discovery') {
    return {
      mode,
      score: issueScore,
      cred: issueCred,
      eligible: issueEligible,
      usd: discUsd,
      counts: {
        primaryLabel: 'Solved',
        primary: solved,
        open: m.totalOpenIssues ?? 0,
        closed: closedIssue,
      },
    };
  }
  if (mode === 'oss') {
    return {
      mode,
      score: ossScore,
      cred: ossCred,
      eligible: ossEligible,
      usd: ossUsd,
      counts: {
        primaryLabel: 'Merged',
        primary: merged,
        open: m.totalOpenPrs ?? 0,
        closed: closedPr,
      },
    };
  }
  const combinedCred = acceptanceRate(merged + solved, closedPr + closedIssue);
  return {
    mode,
    score: combinedScore,
    cred: combinedCred,
    eligible: ossEligible || issueEligible,
    usd: ossUsd + discUsd,
    counts: {
      primaryLabel: 'Done',
      primary: merged + solved,
      open: (m.totalOpenPrs ?? 0) + (m.totalOpenIssues ?? 0),
      closed: closedPr + closedIssue,
    },
  };
}

// API compat — no longer colors per tone.
export function credColor(_v: number): string {
  return 'var(--fg-default)';
}
