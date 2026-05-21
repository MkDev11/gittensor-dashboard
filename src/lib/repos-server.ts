// Server-only: this module imports `db` (better-sqlite3) and must never be
// imported by client components. The `repos.ts` sibling stays as the
// client-safe type/helper surface; the bundled JSON snapshot it ships is
// intentionally not consulted here: live is the sole source of truth.
import {
  DEFAULT_SCORING,
  type RepoEligibilityConfig,
  type RepoEntry,
  type RepoScoringConfig,
  type RepoTimeDecayConfig,
  type Sn74Repo,
} from './repos';
import { getDb } from './db';
import {
  DEFAULT_EXCESSIVE_PR_PENALTY_THRESHOLD,
  DEFAULT_MIN_CREDIBILITY,
  DEFAULT_MIN_ISSUE_CREDIBILITY,
  DEFAULT_OPEN_ISSUE_SPAM_THRESHOLD,
} from './gittensor-policy';

// Live source. We poll entrius/gittensor:main/master_repositories.json every
// 5 minutes. Per-poll semantics:
//   * Repos present in upstream  -> weight/config set to live values.
//   * Repos previously seen but absent upstream -> weight set to 0.
//   * Repos new to upstream -> row inserted with live weight/config.
//   * Nothing is ever deleted.
const REMOTE_URL =
  'https://raw.githubusercontent.com/entrius/gittensor/main/gittensor/validator/weights/master_repositories.json';
const REFRESH_MS = 5 * 60 * 1000;
const DEFAULT_ISSUE_DISCOVERY_SHARE = 0.5;

interface MasterRepoEligibility {
  min_valid_merged_prs?: number | null;
  min_credibility?: number | null;
  min_token_score_for_base_score?: number | null;
  excessive_pr_penalty_base_threshold?: number | null;
  open_pr_threshold_token_score?: number | null;
  max_open_pr_threshold?: number | null;
  min_valid_solved_issues?: number | null;
  min_issue_credibility?: number | null;
  min_token_score_for_valid_issue?: number | null;
  open_issue_spam_base_threshold?: number | null;
  open_issue_spam_token_score_per_slot?: number | null;
  max_open_issue_threshold?: number | null;
}

interface MasterRepoTimeDecay {
  grace_period_hours?: number | null;
  sigmoid_midpoint_days?: number | null;
  sigmoid_steepness?: number | null;
  min_multiplier?: number | null;
}

interface MasterRepoScoring {
  pr_lookback_days?: number | null;
  open_pr_collateral_percent?: number | null;
  review_penalty_rate?: number | null;
  standard_issue_multiplier?: number | null;
  maintainer_issue_multiplier?: number | null;
  time_decay?: MasterRepoTimeDecay | null;
}

// Upstream replaced `weight` with `emission_share` plus scoring knobs. The hub
// keeps `weight` as a UI/backward-compatible alias and also surfaces the
// detailed scoring policy for dashboard explanations.
interface MasterRepoEntry {
  emission_share?: number | string | null;
  issue_discovery_share?: number | string | null;
  maintainer_cut?: number | string | null;
  eligibility_mode?: boolean;
  eligibility?: MasterRepoEligibility | null;
  scoring?: MasterRepoScoring | null;
  fixed_base_score?: number | string | null;
  label_multipliers?: Record<string, number | string> | null;
  default_label_multiplier?: number | string | null;
  trusted_label_pipeline?: boolean | null;
  additional_acceptable_branches?: string[] | null;
  // Legacy field: older snapshots used this; keep as fallback in case the
  // upstream schema regresses or a mirror still serves the old shape.
  weight?: number | string | null;
  inactive_at?: string | null;
}

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

function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : fallback;
  return Number.isFinite(n) ? n : fallback;
}

function nullableNum(value: unknown): number | null {
  if (value == null) return null;
  const n = num(value, Number.NaN);
  return Number.isFinite(n) ? n : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];
}

function normalizeEligibility(raw: MasterRepoEligibility | null | undefined): RepoEligibilityConfig {
  if (!raw) return { ...EMPTY_ELIGIBILITY };
  return {
    minValidMergedPrs: nullableNum(raw.min_valid_merged_prs),
    minCredibility: nullableNum(raw.min_credibility),
    minTokenScoreForBaseScore: nullableNum(raw.min_token_score_for_base_score),
    excessivePrPenaltyBaseThreshold: nullableNum(raw.excessive_pr_penalty_base_threshold),
    openPrThresholdTokenScore: nullableNum(raw.open_pr_threshold_token_score),
    maxOpenPrThreshold: nullableNum(raw.max_open_pr_threshold),
    minValidSolvedIssues: nullableNum(raw.min_valid_solved_issues),
    minIssueCredibility: nullableNum(raw.min_issue_credibility),
    minTokenScoreForValidIssue: nullableNum(raw.min_token_score_for_valid_issue),
    openIssueSpamBaseThreshold: nullableNum(raw.open_issue_spam_base_threshold),
    openIssueSpamTokenScorePerSlot: nullableNum(raw.open_issue_spam_token_score_per_slot),
    maxOpenIssueThreshold: nullableNum(raw.max_open_issue_threshold),
  };
}

function normalizeTimeDecay(raw: MasterRepoTimeDecay | null | undefined): RepoTimeDecayConfig {
  return {
    gracePeriodHours: num(raw?.grace_period_hours, DEFAULT_SCORING.timeDecay.gracePeriodHours),
    sigmoidMidpointDays: num(raw?.sigmoid_midpoint_days, DEFAULT_SCORING.timeDecay.sigmoidMidpointDays),
    sigmoidSteepness: num(raw?.sigmoid_steepness, DEFAULT_SCORING.timeDecay.sigmoidSteepness),
    minMultiplier: num(raw?.min_multiplier, DEFAULT_SCORING.timeDecay.minMultiplier),
  };
}

function normalizeScoring(raw: MasterRepoScoring | null | undefined): RepoScoringConfig {
  return {
    prLookbackDays: num(raw?.pr_lookback_days, DEFAULT_SCORING.prLookbackDays),
    openPrCollateralPercent: num(raw?.open_pr_collateral_percent, DEFAULT_SCORING.openPrCollateralPercent),
    reviewPenaltyRate: num(raw?.review_penalty_rate, DEFAULT_SCORING.reviewPenaltyRate),
    standardIssueMultiplier: num(raw?.standard_issue_multiplier, DEFAULT_SCORING.standardIssueMultiplier),
    maintainerIssueMultiplier: num(raw?.maintainer_issue_multiplier, DEFAULT_SCORING.maintainerIssueMultiplier),
    timeDecay: normalizeTimeDecay(raw?.time_decay),
  };
}

function normalizeLabelMultipliers(raw: MasterRepoEntry['label_multipliers']): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [label, multiplier] of Object.entries(raw)) {
    const parsed = num(multiplier, Number.NaN);
    if (label.trim() && Number.isFinite(parsed)) out[label] = parsed;
  }
  return out;
}

function entryWeight(ent: MasterRepoEntry): number {
  return num(ent.emission_share ?? ent.weight, 0);
}

function entryInactiveAt(ent: MasterRepoEntry): string | null {
  // New schema: eligibility_mode=false marks an explicitly ineligible repo.
  // We don't have a real timestamp to attach, but consumers only check
  // truthiness on inactiveAt, so a synthetic marker is enough.
  if (ent.eligibility_mode === false) return ent.inactive_at ?? 'ineligible';
  return ent.inactive_at ?? null;
}

function baseRepoEntry(fullName: string, weight: number): RepoEntry {
  const [owner, name] = fullName.split('/');
  return {
    fullName,
    owner,
    name,
    weight,
    emissionShare: weight,
    issueDiscoveryShare: DEFAULT_ISSUE_DISCOVERY_SHARE,
    maintainerCut: 0,
    fixedBaseScore: null,
    labelMultipliers: {},
    defaultLabelMultiplier: 1,
    trustedLabelPipeline: false,
    additionalAcceptableBranches: [],
    eligibility: { ...EMPTY_ELIGIBILITY },
    scoring: { ...DEFAULT_SCORING, timeDecay: { ...DEFAULT_SCORING.timeDecay } },
    excessivePrPenaltyThreshold: DEFAULT_EXCESSIVE_PR_PENALTY_THRESHOLD,
    openIssueSpamThreshold: DEFAULT_OPEN_ISSUE_SPAM_THRESHOLD,
    minCredibility: DEFAULT_MIN_CREDIBILITY,
    minIssueCredibility: DEFAULT_MIN_ISSUE_CREDIBILITY,
    inactiveAt: null,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function buildRepoEntry(fullName: string, ent: MasterRepoEntry): RepoEntry {
  const weight = entryWeight(ent);
  const eligibility = normalizeEligibility(ent.eligibility);
  return {
    ...baseRepoEntry(fullName, weight),
    issueDiscoveryShare: clamp01(num(ent.issue_discovery_share, DEFAULT_ISSUE_DISCOVERY_SHARE)),
    maintainerCut: num(ent.maintainer_cut, 0),
    fixedBaseScore: nullableNum(ent.fixed_base_score),
    labelMultipliers: normalizeLabelMultipliers(ent.label_multipliers),
    defaultLabelMultiplier: num(ent.default_label_multiplier, 1),
    trustedLabelPipeline: Boolean(ent.trusted_label_pipeline),
    additionalAcceptableBranches: stringList(ent.additional_acceptable_branches),
    eligibility,
    scoring: normalizeScoring(ent.scoring),
    excessivePrPenaltyThreshold: eligibility.excessivePrPenaltyBaseThreshold ?? DEFAULT_EXCESSIVE_PR_PENALTY_THRESHOLD,
    openIssueSpamThreshold: eligibility.openIssueSpamBaseThreshold ?? DEFAULT_OPEN_ISSUE_SPAM_THRESHOLD,
    minCredibility: eligibility.minCredibility ?? DEFAULT_MIN_CREDIBILITY,
    minIssueCredibility: eligibility.minIssueCredibility ?? DEFAULT_MIN_ISSUE_CREDIBILITY,
    inactiveAt: entryInactiveAt(ent),
  };
}

function storedRepoEntry(fullName: string, weight: number, rawConfig: string | null): RepoEntry {
  if (!rawConfig) return baseRepoEntry(fullName, weight);
  try {
    const entry = buildRepoEntry(fullName, JSON.parse(rawConfig) as MasterRepoEntry);
    return { ...entry, weight, emissionShare: weight };
  } catch {
    return baseRepoEntry(fullName, weight);
  }
}

let lastFetchedAt = 0;
// Stamped on every attempt (success or failure) so a failed fetch is
// throttled by FAILURE_BACKOFF_MS instead of amplifying load while
// `lastFetchedAt` stays at 0.
let lastAttemptAt = 0;
let inFlight: Promise<void> | null = null;

const FAILURE_BACKOFF_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;

// In-memory mirror of the latest live JSON, keyed by lower-cased full_name.
// The DB persists a cold-start floor, while this map represents the current
// authoritative live snapshot after a successful fetch.
const liveByLc = new Map<string, RepoEntry>();
const liveConfigJsonByLc = new Map<string, string>();

async function refreshLiveIfStale(): Promise<void> {
  const sinceSuccess = Date.now() - lastFetchedAt;
  const sinceAttempt = Date.now() - lastAttemptAt;
  if (lastFetchedAt > 0 && sinceSuccess < REFRESH_MS) return;
  if (lastAttemptAt > lastFetchedAt && sinceAttempt < FAILURE_BACKOFF_MS) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const r = await fetch(REMOTE_URL, {
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as Record<string, MasterRepoEntry>;

      liveByLc.clear();
      liveConfigJsonByLc.clear();
      for (const [fn, ent] of Object.entries(data)) {
        const key = fn.toLowerCase();
        liveByLc.set(key, buildRepoEntry(fn, ent));
        liveConfigJsonByLc.set(key, JSON.stringify(ent));
      }

      const db = getDb();
      const existing = db
        .prepare('SELECT full_name, weight, config_json FROM repo_weights')
        .all() as Array<{ full_name: string; weight: number; config_json: string | null }>;
      const existingLc = new Set(existing.map((r) => r.full_name.toLowerCase()));

      const upsert = db.prepare(
        `INSERT INTO repo_weights (full_name, weight, updated_at, config_json) VALUES (?, ?, ?, ?)
         ON CONFLICT(full_name) DO UPDATE SET
           weight = excluded.weight,
           updated_at = excluded.updated_at,
           config_json = excluded.config_json`,
      );
      const now = new Date().toISOString();
      let zeroed = 0;
      let updated = 0;
      let added = 0;
      const tx = db.transaction(() => {
        for (const e of existing) {
          const key = e.full_name.toLowerCase();
          const live = liveByLc.get(key);
          const liveConfigJson = liveConfigJsonByLc.get(key) ?? null;
          if (live) {
            if (e.weight !== live.weight || (e.config_json ?? null) !== liveConfigJson) {
              upsert.run(e.full_name, live.weight, now, liveConfigJson);
              updated += 1;
            }
          } else if (e.weight !== 0) {
            upsert.run(e.full_name, 0, now, e.config_json);
            zeroed += 1;
          }
        }
        for (const [key, live] of liveByLc.entries()) {
          if (existingLc.has(key)) continue;
          upsert.run(live.fullName, live.weight, now, liveConfigJsonByLc.get(key) ?? null);
          added += 1;
        }
      });
      tx();
      lastFetchedAt = Date.now();
      console.log(
        `[repos] live sync: ${liveByLc.size} upstream | ${added} added, ${updated} re-weighted/configured, ${zeroed} zeroed`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[repos] live fetch failed (${msg})`);
    } finally {
      lastAttemptAt = Date.now();
      inFlight = null;
    }
  })();
  return inFlight;
}

function readAll(): Sn74Repo[] {
  try {
    const rows = getDb()
      .prepare('SELECT full_name, weight, config_json FROM repo_weights')
      .all() as Array<{ full_name: string; weight: number; config_json: string | null }>;
    if (lastFetchedAt === 0) {
      return rows.map((r) => storedRepoEntry(r.full_name, r.weight, r.config_json));
    }
    return rows
      .filter((r) => liveByLc.has(r.full_name.toLowerCase()))
      .map((r) => liveByLc.get(r.full_name.toLowerCase()) ?? storedRepoEntry(r.full_name, r.weight, r.config_json));
  } catch {
    return [];
  }
}

function buildList(): Sn74Repo[] {
  return readAll().sort((a, b) => b.weight - a.weight);
}

export function getLiveReposServer(): Sn74Repo[] {
  void refreshLiveIfStale();
  return buildList();
}

export async function getLiveReposAsyncServer(): Promise<{
  repos: Sn74Repo[];
  source: 'live' | 'empty';
  fetchedAt: number;
}> {
  await refreshLiveIfStale();
  return {
    repos: buildList(),
    source: lastFetchedAt > 0 ? 'live' : 'empty',
    fetchedAt: lastFetchedAt,
  };
}

export async function getIssueDiscoveryDisabledReposAsyncServer(repoFullNames: Iterable<string>): Promise<Set<string>> {
  await refreshLiveIfStale();
  const disabled = new Set<string>();
  for (const repoFullName of repoFullNames) {
    const live = liveByLc.get(repoFullName.toLowerCase());
    if (live?.issueDiscoveryShare === 0) disabled.add(repoFullName.toLowerCase());
  }
  return disabled;
}
