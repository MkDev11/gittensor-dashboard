// Server-only: this module imports `db` (better-sqlite3) and must never be
// imported by client components. The `repos.ts` sibling stays as the
// client-safe type/helper surface; the bundled JSON snapshot it ships is
// intentionally not consulted here — live is the sole source of truth.
import type { Sn74Repo } from './repos';
import { getDb } from './db';

// Live source. We poll entrius/gittensor:main/master_repositories.json every
// 5 minutes. Per-poll semantics:
//   * Repos present in upstream  → weight set to live's weight.
//   * Repos previously seen but absent upstream → weight set to 0.
//   * Repos new to upstream → row inserted with live's weight.
//   * Nothing is ever deleted.
const REMOTE_URL =
  'https://raw.githubusercontent.com/entrius/gittensor/main/gittensor/validator/weights/master_repositories.json';
const REFRESH_MS = 5 * 60 * 1000;

// Upstream replaced `weight` with `emission_share` plus a set of scoring
// knobs. We map `emission_share` → internal `weight` and surface the current
// scoring policy so the explorer can explain how a repo's pool is configured.
interface MasterRepoEntry {
  emission_share?: number;
  issue_discovery_share?: number;
  maintainer_cut?: number;
  eligibility_mode?: boolean;
  fixed_base_score?: number;
  eligibility?: {
    min_credibility?: number;
    min_issue_credibility?: number;
    excessive_pr_penalty_base_threshold?: number;
    open_issue_spam_base_threshold?: number;
  };
  label_multipliers?: Record<string, number>;
  default_label_multiplier?: number;
  trusted_label_pipeline?: boolean;
  additional_acceptable_branches?: string[];
  // Legacy field — older snapshots used this; keep as a fallback in case the
  // upstream schema regresses or a mirror still serves the old shape.
  weight?: number;
  inactive_at?: string | null;
}

type LiveRepoMeta = {
  fullName: string;
  weight: number;
  issueDiscoveryShare: number | null;
  maintainerCut: number | null;
  fixedBaseScore: number | null;
  excessivePrPenaltyThreshold: number | null;
  openIssueSpamThreshold: number | null;
  minCredibility: number | null;
  minIssueCredibility: number | null;
  defaultLabelMultiplier: number | null;
  trustedLabelPipeline: boolean | null;
  additionalAcceptableBranches: string[] | null;
  labelMultipliers: Record<string, number> | null;
  inactiveAt: string | null;
};

const DEFAULT_MIN_CREDIBILITY = 0.8;
const DEFAULT_MIN_ISSUE_CREDIBILITY = 0.8;
const DEFAULT_EXCESSIVE_PR_PENALTY_THRESHOLD = 2;
const DEFAULT_OPEN_ISSUE_SPAM_THRESHOLD = 2;

function entryWeight(ent: MasterRepoEntry): number {
  if (typeof ent.emission_share === 'number') return ent.emission_share;
  if (typeof ent.weight === 'number') return ent.weight;
  return 0;
}

function entryIssueDiscoveryShare(ent: MasterRepoEntry): number | null {
  return typeof ent.issue_discovery_share === 'number' ? ent.issue_discovery_share : null;
}

function entryMaintainerCut(ent: MasterRepoEntry): number | null {
  return typeof ent.maintainer_cut === 'number' ? ent.maintainer_cut : 0;
}

function entryFixedBaseScore(ent: MasterRepoEntry): number | null {
  return typeof ent.fixed_base_score === 'number' ? ent.fixed_base_score : null;
}

function entryEligibilityNumber(
  ent: MasterRepoEntry,
  key: keyof NonNullable<MasterRepoEntry['eligibility']>,
  fallback: number,
): number | null {
  const value = ent.eligibility?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
}

function entryDefaultLabelMultiplier(ent: MasterRepoEntry): number | null {
  return typeof ent.default_label_multiplier === 'number' ? ent.default_label_multiplier : 1;
}

function entryTrustedLabelPipeline(ent: MasterRepoEntry): boolean | null {
  return typeof ent.trusted_label_pipeline === 'boolean' ? ent.trusted_label_pipeline : false;
}

function entryAdditionalAcceptableBranches(ent: MasterRepoEntry): string[] | null {
  if (!Array.isArray(ent.additional_acceptable_branches)) return [];
  return ent.additional_acceptable_branches.filter((branch): branch is string => typeof branch === 'string' && branch.trim() !== '');
}

function entryLabelMultipliers(ent: MasterRepoEntry): Record<string, number> | null {
  if (!ent.label_multipliers) return null;
  const entries = Object.entries(ent.label_multipliers).filter((entry): entry is [string, number] => {
    const [label, multiplier] = entry;
    return label.trim() !== '' && typeof multiplier === 'number' && Number.isFinite(multiplier);
  });
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function entryInactiveAt(ent: MasterRepoEntry): string | null {
  // New schema: `eligibility_mode: false` marks an explicitly ineligible repo.
  // We don't have a real timestamp to attach, but the dashboard only checks
  // truthiness on `inactiveAt`, so a synthetic marker is enough.
  if (ent.eligibility_mode === false) return ent.inactive_at ?? 'ineligible';
  return ent.inactive_at ?? null;
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
// The DB persists weights across restarts, but `inactive_at` lives only here
// (the `repo_weights` table doesn't carry it). Repopulated on every live
// fetch; empty until the first fetch resolves.
const liveByLc = new Map<string, LiveRepoMeta>();

async function refreshLiveIfStale(): Promise<void> {
  // Honor the 5-minute window after a successful fetch, and a shorter
  // backoff after a failure — otherwise a degraded upstream would see every
  // incoming request kick off a new fetch.
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

      // Rebuild the in-memory mirror from scratch every poll so dropped
      // entries vanish from the inactiveAt lookup. GitHub repo names are
      // case-insensitive, so we should not treat `entrius/OC-1` and
      // `entrius/oc-1` as different repos.
      liveByLc.clear();
      for (const [fn, ent] of Object.entries(data)) {
        liveByLc.set(fn.toLowerCase(), {
          fullName: fn,
          weight: entryWeight(ent),
          issueDiscoveryShare: entryIssueDiscoveryShare(ent),
          maintainerCut: entryMaintainerCut(ent),
          fixedBaseScore: entryFixedBaseScore(ent),
          excessivePrPenaltyThreshold: entryEligibilityNumber(
            ent,
            'excessive_pr_penalty_base_threshold',
            DEFAULT_EXCESSIVE_PR_PENALTY_THRESHOLD,
          ),
          openIssueSpamThreshold: entryEligibilityNumber(
            ent,
            'open_issue_spam_base_threshold',
            DEFAULT_OPEN_ISSUE_SPAM_THRESHOLD,
          ),
          minCredibility: entryEligibilityNumber(ent, 'min_credibility', DEFAULT_MIN_CREDIBILITY),
          minIssueCredibility: entryEligibilityNumber(ent, 'min_issue_credibility', DEFAULT_MIN_ISSUE_CREDIBILITY),
          defaultLabelMultiplier: entryDefaultLabelMultiplier(ent),
          trustedLabelPipeline: entryTrustedLabelPipeline(ent),
          additionalAcceptableBranches: entryAdditionalAcceptableBranches(ent),
          labelMultipliers: entryLabelMultipliers(ent),
          inactiveAt: entryInactiveAt(ent),
        });
      }

      const db = getDb();
      const existing = db
        .prepare('SELECT full_name, weight FROM repo_weights')
        .all() as Array<{ full_name: string; weight: number }>;
      const existingLc = new Set(existing.map((r) => r.full_name.toLowerCase()));

      const upsert = db.prepare(
        `INSERT INTO repo_weights (full_name, weight, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(full_name) DO UPDATE SET weight = excluded.weight, updated_at = excluded.updated_at`,
      );
      const now = new Date().toISOString();
      let zeroed = 0;
      let updated = 0;
      let added = 0;
      const tx = db.transaction(() => {
        // Existing repos: set to live weight, or 0 if upstream dropped them.
        for (const e of existing) {
          const live = liveByLc.get(e.full_name.toLowerCase());
          if (live) {
            if (e.weight !== live.weight) {
              upsert.run(e.full_name, live.weight, now);
              updated += 1;
            }
          } else if (e.weight !== 0) {
            upsert.run(e.full_name, 0, now);
            zeroed += 1;
          }
        }
        // Brand-new live entries: add with their live weight.
        for (const [lc, live] of liveByLc.entries()) {
          if (existingLc.has(lc)) continue;
          upsert.run(live.fullName, live.weight, now);
          added += 1;
        }
      });
      tx();
      lastFetchedAt = Date.now();
      console.log(
        `[repos] live sync: ${liveByLc.size} upstream | ${added} added, ${updated} re-weighted, ${zeroed} zeroed`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[repos] live fetch failed (${msg})`);
    } finally {
      // Stamp the attempt regardless of outcome so the failure backoff
      // engages even when the request threw before reaching the success path.
      lastAttemptAt = Date.now();
      inFlight = null;
    }
  })();
  return inFlight;
}

function readAll(): Sn74Repo[] {
  try {
    const rows = getDb()
      .prepare('SELECT full_name, weight FROM repo_weights')
      .all() as Array<{ full_name: string; weight: number }>;
    // Cold-start floor: before the first live fetch resolves, `liveByLc` is
    // empty even though the DB may have a perfectly good cached snapshot from
    // a previous run. Serve those rows verbatim (with `inactiveAt: null`)
    // instead of returning [] — otherwise a transient outage at boot would
    // render an empty dashboard.
    if (lastFetchedAt === 0) {
      return rows.map((r) => {
        const [owner, name] = r.full_name.split('/');
        return {
          fullName: r.full_name,
          owner,
          name,
          weight: r.weight,
          issueDiscoveryShare: null,
          maintainerCut: null,
          fixedBaseScore: null,
          excessivePrPenaltyThreshold: null,
          openIssueSpamThreshold: null,
          minCredibility: null,
          minIssueCredibility: null,
          defaultLabelMultiplier: null,
          trustedLabelPipeline: null,
          additionalAcceptableBranches: null,
          labelMultipliers: null,
          inactiveAt: null,
        };
      });
    }
    // Steady state: surface only rows present in the CURRENT live snapshot.
    // The DB still keeps historical rows (we never delete) for cache/audit,
    // but the displayed list mirrors live exactly — anything that's been
    // dropped upstream stops being rendered.
    return rows
      .filter((r) => liveByLc.has(r.full_name.toLowerCase()))
      .map((r) => {
        const [owner, name] = r.full_name.split('/');
        const live = liveByLc.get(r.full_name.toLowerCase());
        return {
          fullName: r.full_name,
          owner,
          name,
          weight: r.weight,
          issueDiscoveryShare: live?.issueDiscoveryShare ?? null,
          maintainerCut: live?.maintainerCut ?? null,
          fixedBaseScore: live?.fixedBaseScore ?? null,
          excessivePrPenaltyThreshold: live?.excessivePrPenaltyThreshold ?? null,
          openIssueSpamThreshold: live?.openIssueSpamThreshold ?? null,
          minCredibility: live?.minCredibility ?? null,
          minIssueCredibility: live?.minIssueCredibility ?? null,
          defaultLabelMultiplier: live?.defaultLabelMultiplier ?? null,
          trustedLabelPipeline: live?.trustedLabelPipeline ?? null,
          additionalAcceptableBranches: live?.additionalAcceptableBranches ?? null,
          labelMultipliers: live?.labelMultipliers ?? null,
          inactiveAt: live?.inactiveAt ?? null,
        };
      });
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
    // `empty` means we haven't completed a live fetch yet — the DB may still
    // have a previous run's snapshot (served by `readAll`'s cold-start floor)
    // but we cannot vouch for its freshness.
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
