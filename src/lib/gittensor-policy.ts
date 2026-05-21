export const DEFAULT_MIN_CREDIBILITY = 0.8;
export const DEFAULT_MIN_ISSUE_CREDIBILITY = 0.8;
export const DEFAULT_EXCESSIVE_PR_PENALTY_THRESHOLD = 2;
export const DEFAULT_OPEN_ISSUE_SPAM_THRESHOLD = 2;
// Mirrors gittensor/constants.py PR_LOOKBACK_DAYS — the rolling window the
// validator scores. Per-repo overrides exist on-chain but the hub displays
// the default; anything outside this window earns 0 (or the 5% decay floor).
export const PR_LOOKBACK_DAYS = 30;
