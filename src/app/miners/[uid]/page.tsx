'use client';

export const dynamic = 'force-dynamic';

import React, { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PageLayout, Heading, Text, Box, Label } from '@primer/react';
import {
  ArrowLeftIcon,
  StarIcon,
  StarFillIcon,
  MarkGithubIcon,
  RepoIcon,
  GitPullRequestIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  IssueOpenedIcon,
  IssueClosedIcon,
  SkipIcon,
  DiffAddedIcon,
  DiffRemovedIcon,
  KeyIcon,
  LinkExternalIcon,
  TrophyIcon,
  ZapIcon,
  CopyIcon,
  CheckIcon,
  CommentDiscussionIcon,
  ClockIcon,
  BeakerIcon,
  XIcon,
} from '@primer/octicons-react';
import { useTrackedMiners } from '@/lib/tracked-miners';
import { useMinerLogin } from '@/lib/use-miner';
import { formatUsd, formatRelativeTime } from '@/lib/format';

/* =========================================================================
 * Types — mirror /api/gt/miners/[uid] response.
 * ========================================================================= */

interface MinerProfile {
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

interface PrDetail {
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
}

type IssueBucket = 'solved' | 'completed' | 'open' | 'closed';

interface IssueDetail {
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

interface RepoEval {
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

interface DetailResp {
  miner: MinerProfile;
  prs: PrDetail[];
  discoveredIssues: IssueDetail[];
  solvedIssues: IssueDetail[];
  repoEvals: RepoEval[];
  fetched_at: number;
}

/* =========================================================================
 * Period selector
 * ========================================================================= */

type Period = '1D' | '7D' | '35D' | 'ALL';
type Mode = 'oss' | 'discovery';

const PERIODS: { key: Period; label: string; days: number | null; full: string }[] = [
  { key: '1D', label: '1D', days: 1, full: 'Last 24h' },
  { key: '7D', label: '7D', days: 7, full: 'Last 7d' },
  { key: '35D', label: '35D', days: 35, full: 'Last 35d' },
  { key: 'ALL', label: 'All', days: null, full: 'All time' },
];

function withinPeriod(iso: string | null | undefined, days: number | null): boolean {
  if (days === null) return true;
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < days * 24 * 60 * 60 * 1000;
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

/* =========================================================================
 * Page
 * ========================================================================= */

export default function MinerDetailPage(ctx: { params: Promise<{ uid: string }> }) {
  const params = use(ctx.params);
  const uid = params.uid;
  const me = useMinerLogin();
  const { tracked, toggle } = useTrackedMiners();
  const [period, setPeriod] = useState<Period>('35D');
  const [mode, setMode] = useState<Mode>('oss');
  const [copied, setCopied] = useState(false);
  // `null` = "all repositories". Clicking a repo row sets it; clicking
  // again deselects. Code Impact / PRs / Issue Discoveries panels read
  // this and re-filter, so the lower half of the page always reflects
  // "what is this miner doing in this one repo, in this window".
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);

  const { data, isError } = useQuery<DetailResp>({
    queryKey: ['miner-detail', uid],
    queryFn: async () => {
      const r = await fetch(`/api/gt/miners/${uid}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const miner = data?.miner;
  const isMe = miner?.githubUsername?.toLowerCase() === (me || '').toLowerCase();
  const isTracked = miner ? tracked.has(String(miner.uid)) : false;
  const periodDays = PERIODS.find((p) => p.key === period)?.days ?? null;

  const prs = data?.prs ?? [];
  const discovered = data?.discoveredIssues ?? [];
  const solved = data?.solvedIssues ?? [];
  const repoEvalMap = useMemo(() => {
    const m = new Map<string, RepoEval>();
    for (const e of data?.repoEvals ?? []) m.set(e.repo.toLowerCase(), e);
    return m;
  }, [data?.repoEvals]);

  // Mode-aware issue universe: Discovery focuses on author=miner; the
  // solved set is shown as a separate breakout inside the same view so
  // both "I found it" and "I solved it" stay visible.
  const prsInPeriod = useMemo(
    () => prs.filter((p) => withinPeriod(p.prCreatedAt, periodDays)),
    [prs, periodDays],
  );
  const discoveredInPeriod = useMemo(
    () => discovered.filter((i) => withinPeriod(i.createdAt, periodDays)),
    [discovered, periodDays],
  );
  const solvedInPeriod = useMemo(
    () => solved.filter((i) => withinPeriod(i.closedAt ?? i.createdAt, periodDays)),
    [solved, periodDays],
  );

  // Repo-filtered slices feeding Code Impact / PR list / Issue list.
  // When `selectedRepo === null`, these are identical to the in-period
  // arrays; when a repo is selected they narrow to that one repo.
  const prsFiltered = useMemo(
    () => (selectedRepo ? prsInPeriod.filter((p) => p.repository.toLowerCase() === selectedRepo.toLowerCase()) : prsInPeriod),
    [prsInPeriod, selectedRepo],
  );
  const discoveredFiltered = useMemo(
    () => (selectedRepo ? discoveredInPeriod.filter((i) => i.repo.toLowerCase() === selectedRepo.toLowerCase()) : discoveredInPeriod),
    [discoveredInPeriod, selectedRepo],
  );
  const prAgg = useMemo(() => {
    let merged = 0, open = 0, closed = 0;
    let realScoreSum = 0, actualScoreSum = 0, collateralSum = 0;
    let additions = 0, deletions = 0, predictedUsd = 0;
    const repos = new Set<string>();
    for (const p of prsInPeriod) {
      if (p.prState === 'MERGED') merged += 1;
      else if (p.prState === 'OPEN') open += 1;
      else closed += 1;
      realScoreSum += p.realScore;
      actualScoreSum += p.score;
      collateralSum += p.collateralScore;
      additions += p.additions;
      deletions += p.deletions;
      predictedUsd += p.predictedUsdPerDay;
      repos.add(p.repository);
    }
    return {
      total: prsInPeriod.length, merged, open, closed,
      realScoreSum, actualScoreSum, collateralSum,
      additions, deletions, predictedUsd,
      uniqueRepos: repos.size,
    };
  }, [prsInPeriod]);

  const issueAgg = useMemo(() => {
    let dSolved = 0, dCompleted = 0, dOpen = 0, dClosed = 0;
    for (const i of discoveredInPeriod) {
      if (i.bucket === 'solved') dSolved += 1;
      else if (i.bucket === 'completed') dCompleted += 1;
      else if (i.bucket === 'open') dOpen += 1;
      else dClosed += 1;
    }
    const repos = new Set<string>();
    for (const i of discoveredInPeriod) repos.add(i.repo);
    return {
      total: discoveredInPeriod.length,
      solved: dSolved,
      completed: dCompleted,
      open: dOpen,
      closed: dClosed,
      solvedExternal: solvedInPeriod.length,
      uniqueRepos: repos.size,
    };
  }, [discoveredInPeriod, solvedInPeriod]);

  // Per-repo grouping. Aggregates PR + Issue rows under the same repo so
  // the breakdown card reads as "what is this miner doing where".
  const repoBreakdown = useMemo(() => {
    // Resolve repo names to a single canonical casing. Prefers mixed-case (e.g. "MkDev11/gittensor-hub")
    // over all-lowercase, because different data sources (PRs vs issues vs validator) use different casings.
    const canonicalName = new Map<string, string>(); // lowercase → canonical
    const registerName = (name: string) => {
      const key = name.toLowerCase();
      const existing = canonicalName.get(key);
      if (!existing || (name !== name.toLowerCase() && existing === existing.toLowerCase())) {
        canonicalName.set(key, name);
      }
    };
    for (const e of data?.repoEvals ?? []) registerName(e.repo);
    for (const p of prsInPeriod) registerName(p.repository);
    for (const i of discoveredInPeriod) registerName(i.repo);
    for (const i of solvedInPeriod) registerName(i.repo);
    const resolve = (r: string) => canonicalName.get(r.toLowerCase()) ?? r;

    const map = new Map<string, RepoBucket>();
    const get = (r: string): RepoBucket => {
      const canonical = resolve(r);
      let row = map.get(canonical);
      if (!row) {
        row = makeRepoBucket(canonical);
        map.set(canonical, row);
      }
      return row;
    };
    for (const p of prsInPeriod) {
      const r = get(p.repository);
      r.prs.push(p);
      if (p.prState === 'MERGED') {
        r.merged += 1;
        if (p.tokenScore >= 5) r.validPrs += 1;
      } else if (p.prState === 'OPEN') r.openPr += 1;
      else r.closedPr += 1;
      r.realScore += p.realScore;
      r.actualScore += p.score;
      r.additions += p.additions;
      r.deletions += p.deletions;
      r.predictedUsd += p.predictedUsdPerDay;
    }
    for (const i of discoveredInPeriod) {
      const r = get(i.repo);
      r.discovered.push(i);
      if (i.bucket === 'open') r.openIssue += 1;
      else if (i.bucket === 'solved') r.solvedIssue += 1;
      else if (i.bucket === 'completed') r.completedIssue += 1;
      else r.closedIssue += 1;
    }
    for (const i of solvedInPeriod) {
      const r = get(i.repo);
      r.solvedByPr.push(i);
    }
    return Array.from(map.values()).sort((a, b) => {
      const aw = mode === 'oss' ? a.prs.length : a.discovered.length + a.solvedByPr.length;
      const bw = mode === 'oss' ? b.prs.length : b.discovered.length + b.solvedByPr.length;
      if (aw !== bw) return bw - aw;
      return b.realScore - a.realScore;
    });
  }, [prsInPeriod, discoveredInPeriod, solvedInPeriod, mode, data?.repoEvals]);

  // Window-scoped eligible repo counts — derived from the same breakdown the table uses,
  // so the hero stats always match the repository panel.
  const ossEligibleCount = useMemo(
    () => repoBreakdown.filter(r => repoEvalMap.get(r.repo.toLowerCase())?.isEligible ?? ossRepoEligible(r)).length,
    [repoBreakdown, repoEvalMap],
  );
  const discEligibleCount = useMemo(
    () => repoBreakdown.filter(r => repoEvalMap.get(r.repo.toLowerCase())?.isIssueEligible ?? discRepoEligible(r)).length,
    [repoBreakdown, repoEvalMap],
  );

  // Code Impact uses repo-filtered PR data so additions/deletions/repos
  // shift when a repo row is selected. When `selectedRepo === null` this
  // is identical to `prAgg` above.
  const prAggFiltered = useMemo(() => {
    let additions = 0, deletions = 0, predictedUsd = 0;
    const repos = new Set<string>();
    for (const p of prsFiltered) {
      additions += p.additions;
      deletions += p.deletions;
      predictedUsd += p.predictedUsdPerDay;
      repos.add(p.repository);
    }
    return {
      total: prsFiltered.length,
      additions,
      deletions,
      predictedUsd,
      uniqueRepos: repos.size,
    };
  }, [prsFiltered]);

  const ghName = miner?.githubUsername || `uid-${uid}`;
  const ghAvatar = `https://github.com/${ghName}.png?size=160`;
  const ossEligible = !!miner?.isEligible;
  const issueEligible = !!miner?.isIssueEligible;

  const usdPerDay = num(miner?.usdPerDay);
  // Score-weighted split matching viewOf() in parts.tsx. When both tracks are
  // eligible, each gets a proportional share based on its score contribution.
  // When only one is eligible it gets 100%; neither eligible → both $0.
  const ossScore = num(miner?.totalScore);
  const issueScore = num(miner?.issueDiscoveryScore);
  const combinedScore = ossScore + issueScore;
  let ossShare = 0, discShare = 0;
  if (ossEligible && issueEligible) {
    ossShare = combinedScore > 0 ? ossScore / combinedScore : 0.5;
    discShare = 1 - ossShare;
  } else if (ossEligible) {
    ossShare = 1;
  } else if (issueEligible) {
    discShare = 1;
  }
  const ossEarningPerDay = usdPerDay * ossShare;
  const discEarningPerDay = usdPerDay * discShare;

  const copyHotkey = async () => {
    if (!miner?.hotkey) return;
    try {
      await navigator.clipboard.writeText(miner.hotkey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  if (isError) {
    return (
      <PageLayout containerWidth="full" padding="normal">
        <PageLayout.Header>
          <BackLink />
        </PageLayout.Header>
        <PageLayout.Content>
          <Box
            sx={{
              p: 4,
              textAlign: 'center',
              border: '1px solid',
              borderColor: 'danger.emphasis',
              bg: 'danger.subtle',
              borderRadius: 2,
            }}
          >
            <Text sx={{ color: 'danger.fg' }}>Could not load miner UID {uid}.</Text>
          </Box>
        </PageLayout.Content>
      </PageLayout>
    );
  }

  return (
    <PageLayout containerWidth="full" padding="normal">
      <PageLayout.Header>
        <BackLink />

        {/* ── Compact hero ───────────────────────────────────────────
         * Two rows wrapped in one card:
         *   Row A: avatar · identity · meta chips · action buttons
         *   Row B: 5 KPI tiles in a tight strip
         * Total height stays under ~200px on desktop.
         */}
        <Box
          sx={{
            mt: 3,
            position: 'relative',
            overflow: 'hidden',
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'border.default',
            bg: 'canvas.subtle',
          }}
        >
          {/* Faint top-edge wash — kept inside the card bounds so the
           * rounded corners aren't "softened" into looking like a pill. */}
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              height: 80,
              backgroundImage:
                'linear-gradient(180deg, var(--accent-subtle) 0%, transparent 100%)',
              opacity: 0.5,
              pointerEvents: 'none',
            }}
          />

          {/* Row A: identity */}
          <Box
            sx={{
              position: 'relative',
              p: 3,
              display: 'grid',
              gridTemplateColumns: ['auto 1fr', null, 'auto 1fr auto'],
              alignItems: 'center',
              gap: 3,
            }}
          >
            <Box
              sx={{
                position: 'relative',
                width: [56, null, 72],
                height: [56, null, 72],
                borderRadius: '50%',
                border: '2px solid',
                borderColor: ossEligible || issueEligible ? 'success.emphasis' : 'border.default',
                boxShadow: ossEligible || issueEligible
                  ? '0 0 0 3px var(--success-subtle), 0 0 20px -4px var(--success-fg)'
                  : 'none',
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ghAvatar}
                alt={ghName}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </Box>

            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap', mb: 1 }}>
                <Heading
                  sx={{
                    fontSize: [3, null, 4],
                    letterSpacing: '-0.02em',
                    color: 'fg.default',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {ghName}
                </Heading>
                {isMe && <Label variant="accent" sx={{ fontSize: 0 }}>you</Label>}
                <Text sx={{ fontFamily: 'mono', fontSize: 0, color: 'fg.muted' }}>
                  UID {miner?.uid ?? uid}
                </Text>
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                <EligibilityChip eligible={ossEligible} label="OSS" />
                <EligibilityChip eligible={issueEligible} label="Discovery" />
                {miner?.hotkey && (
                  <Box
                    as="button"
                    onClick={copyHotkey}
                    aria-label="Copy hotkey"
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 1,
                      px: '8px',
                      py: '3px',
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: 'border.muted',
                      bg: 'canvas.inset',
                      color: copied ? 'var(--success-fg)' : 'fg.muted',
                      fontSize: 0,
                      fontFamily: 'mono',
                      cursor: 'pointer',
                      maxWidth: 240,
                      transition: 'border-color 100ms, color 100ms',
                      '&:hover': { borderColor: 'border.default', color: 'fg.default' },
                    }}
                  >
                    {copied ? <CheckIcon size={10} /> : <KeyIcon size={10} />}
                    <Text
                      sx={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}
                      title={miner.hotkey}
                    >
                      {copied ? 'Copied' : miner.hotkey}
                    </Text>
                    <CopyIcon size={10} />
                  </Box>
                )}
                {miner?.githubUsername && (
                  <Box
                    as="a"
                    href={`https://github.com/${miner.githubUsername}`}
                    target="_blank"
                    rel="noreferrer"
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 1,
                      px: '8px',
                      py: '3px',
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: 'border.muted',
                      bg: 'canvas.inset',
                      color: 'fg.muted',
                      fontSize: 0,
                      fontWeight: 600,
                      textDecoration: 'none',
                      transition: 'border-color 100ms, color 100ms',
                      '&:hover': { borderColor: 'border.default', color: 'fg.default' },
                    }}
                  >
                    <MarkGithubIcon size={10} />
                    GitHub
                    <LinkExternalIcon size={9} />
                  </Box>
                )}
              </Box>
            </Box>

            <Box
              sx={{
                gridColumn: ['1 / -1', null, 'auto'],
                display: 'flex',
                justifyContent: ['flex-start', null, 'flex-end'],
                gap: 2,
              }}
            >
              <Box
                as="button"
                onClick={() => miner && toggle(String(miner.uid))}
                aria-label={isTracked ? 'Untrack miner' : 'Track miner'}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 3,
                  py: '6px',
                  border: '1px solid',
                  borderColor: isTracked ? 'attention.emphasis' : 'border.default',
                  borderRadius: 2,
                  bg: isTracked ? 'attention.subtle' : 'canvas.default',
                  color: isTracked ? 'attention.fg' : 'fg.default',
                  fontWeight: 600,
                  fontSize: 1,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'background-color 100ms, border-color 100ms',
                  '&:hover': {
                    bg: isTracked ? 'attention.subtle' : 'canvas.inset',
                    borderColor: 'attention.emphasis',
                  },
                }}
              >
                {isTracked ? <StarFillIcon size={12} /> : <StarIcon size={12} />}
                {isTracked ? 'Tracked' : 'Track'}
              </Box>
            </Box>
          </Box>

          {/* Row B: hero stats */}
          <Box
            sx={{
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: ['repeat(2, 1fr)', null, 'repeat(5, 1fr)'],
              borderTop: '1px solid',
              borderColor: 'border.muted',
              bg: 'canvas.default',
            }}
          >
            <HeroStat
              icon={<ZapIcon size={12} />}
              label="USD / day"
              value={formatUsd(num(miner?.usdPerDay), { style: 'compact' })}
              sub={num(miner?.usdPerDay) > 0 ? `~${formatUsd(num(miner?.usdPerDay) * 30, { style: 'compact' })} /mo` : 'not earning'}
              accent="var(--success-fg)"
            />
            <HeroStat
              icon={<BeakerIcon size={12} />}
              label="Total Earned"
              value={num(miner?.lifetimeUsd) > 0
                ? formatUsd(num(miner?.lifetimeUsd), { style: 'compact' })
                : num(miner?.lifetimeTao) > 0
                  ? `${num(miner?.lifetimeTao).toFixed(2)}τ`
                  : '—'}
              sub={num(miner?.lifetimeUsd) > 0
                ? `${num(miner?.lifetimeTao).toFixed(2)}τ · ${num(miner?.lifetimeAlpha).toFixed(2)}α`
                : 'lifetime earnings'}
              accent="var(--accent-fg)"
            />
            <HeroStat
              icon={<TrophyIcon size={12} />}
              label="Total Score"
              value={num(miner?.totalScore) > 0 ? num(miner?.totalScore).toFixed(2) : '0'}
              sub={`Base ${num(miner?.baseTotalScore).toFixed(2)}`}
              accent="var(--attention-emphasis)"
            />
            <HeroStat
              icon={<RepoIcon size={12} />}
              label="OSS Repos"
              value={ossEligibleCount.toLocaleString()}
              sub={ossEligible ? 'eligible' : 'not eligible'}
              accent={ossEligible ? 'var(--success-fg)' : 'var(--fg-muted)'}
            />
            <HeroStat
              icon={<RepoIcon size={12} />}
              label="Disc Repos"
              value={discEligibleCount.toLocaleString()}
              sub={issueEligible ? 'eligible' : 'not eligible'}
              accent={issueEligible ? 'var(--done-emphasis)' : 'var(--fg-muted)'}
            />
          </Box>
        </Box>
      </PageLayout.Header>

      <PageLayout.Content>
        {/* ── Toolbar: period + mode + window meta ─────────────────── */}
        <Box
          sx={{
            mt: 3,
            mb: 3,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 2,
            alignItems: 'center',
            justifyContent: 'space-between',
            p: 2,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'border.default',
            bg: 'canvas.subtle',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <ClockIcon size={14} />
            <Text sx={{ fontSize: 0, color: 'fg.muted', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase' }}>
              Window
            </Text>
            <Tabs<Period>
              options={PERIODS.map((p) => ({ key: p.key, label: p.label }))}
              value={period}
              onChange={setPeriod}
            />
          </Box>
          <Tabs<Mode>
            options={[
              { key: 'oss', label: 'OSS', icon: <GitPullRequestIcon size={10} /> },
              { key: 'discovery', label: 'Discovery', icon: <IssueOpenedIcon size={10} /> },
            ]}
            value={mode}
            onChange={setMode}
          />
        </Box>

        {/* ── Stat cards + Activity heatmap side by side ───────────── */}
        <Box
          sx={{
            mb: 3,
            display: 'grid',
            gridTemplateColumns: ['1fr', null, null, '1fr 1fr'],
            alignItems: 'stretch',
            gap: 3,
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {mode === 'oss' ? (
              <OssStats
                agg={prAgg}
                earningsPerDay={ossEarningPerDay}
                eligible={ossEligible}
              />
            ) : (
              <DiscoveryStats
                agg={issueAgg}
                issueScore={num(miner?.issueDiscoveryScore)}
                earningsPerDay={discEarningPerDay}
                minerTotals={{
                  solved: num(miner?.totalSolvedIssues),
                  validSolved: num(miner?.totalValidSolvedIssues),
                  open: num(miner?.totalOpenIssues),
                  closed: num(miner?.totalClosedIssues),
                }}
                period={period}
                eligible={issueEligible}
              />
            )}
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <ActivityHeatmap
              prs={prs}
              discovered={discovered}
              solved={solved}
              period={period}
              mode={mode}
            />
          </Box>
        </Box>

        {/* ── Per-repo breakdown — mode-aware columns ──────────────── */}
        <Box sx={{ mb: 3 }}>
          <RepoBreakdown
            key={mode}
            repos={repoBreakdown}
            selectedRepo={selectedRepo}
            onSelectRepo={(r) => setSelectedRepo((prev) => (prev === r ? null : r))}
            ossEligible={ossEligible}
            issueEligible={issueEligible}
            mode={mode}
            ossEarningPerDay={ossEarningPerDay}
            discEarningPerDay={discEarningPerDay}
            issueDiscoveryScore={num(miner?.issueDiscoveryScore)}
            repoEvalMap={repoEvalMap}
          />
        </Box>

        {/* ── OSS panels (hidden in Discovery mode) ─────────────────── */}
        {mode === 'oss' && (
          <>
            <Box sx={{ mb: 3 }}>
              <CodeImpactCard prAgg={prAggFiltered} miner={miner} />
            </Box>
            <Box sx={{ mb: 3 }}>
              <PrList prs={prsFiltered} loading={!data} uid={uid} />
            </Box>
          </>
        )}

        {/* ── Discovery panel (hidden in OSS mode) ──────────────────── */}
        {mode === 'discovery' && (
          <Box sx={{ mb: 3 }}>
            {!data ? (
              <ListLoading label="Loading issues…" />
            ) : discoveredFiltered.length === 0 ? (
              <EmptyState
                icon={<IssueOpenedIcon size={20} />}
                text="No issue activity in this window."
                hint="Discovery surfaces issues you've authored on GitHub."
              />
            ) : (
              <IssueList
                issues={discoveredFiltered}
                title="Discovered Issues"
                sub="authored by this miner"
                kind="discovered"
                icon={<IssueOpenedIcon size={13} />}
              />
            )}
          </Box>
        )}
      </PageLayout.Content>
    </PageLayout>
  );
}

/* =========================================================================
 * Search + pagination hook + UI helpers
 * ========================================================================= */

function useSearchPage<T>(
  items: T[],
  filter: (item: T, q: string) => boolean,
  pageSize = 15,
) {
  const [search, setSearchRaw] = useState('');
  const [page, setPage] = useState(0);
  const setSearch = useCallback((s: string) => { setSearchRaw(s); setPage(0); }, []);
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return q ? items.filter((i) => filter(i, q)) : items;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const paged = useMemo(
    () => filtered.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [filtered, safePage, pageSize],
  );
  return { search, setSearch, page: safePage, setPage, pageCount, filtered, paged };
}

function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: '4px',
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.default',
        minWidth: 140,
        maxWidth: 240,
      }}
    >
      <Box sx={{ color: 'fg.muted', display: 'inline-flex', flexShrink: 0 }}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z" />
        </svg>
      </Box>
      <Box
        as="input"
        type="text"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder={placeholder}
        sx={{
          border: 'none',
          outline: 'none',
          bg: 'transparent',
          color: 'fg.default',
          fontSize: 0,
          width: '100%',
          fontFamily: 'inherit',
          '&::placeholder': { color: 'fg.subtle' },
        }}
      />
      {value && (
        <Box
          as="button"
          onClick={() => onChange('')}
          sx={{
            border: 'none',
            bg: 'transparent',
            color: 'fg.muted',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            p: 0,
            fontSize: '10px',
            lineHeight: 1,
            '&:hover': { color: 'fg.default' },
          }}
        >
          ✕
        </Box>
      )}
    </Box>
  );
}

function Paginator({
  page,
  pageCount,
  total,
  filtered,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  filtered: number;
  onPage: (p: number) => void;
}) {
  if (pageCount <= 1 && total === filtered) return null;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, fontSize: 0, color: 'fg.muted' }}>
      {total !== filtered && (
        <Text sx={{ fontSize: 0 }}>{filtered.toLocaleString()} / {total.toLocaleString()}</Text>
      )}
      {pageCount > 1 && (
        <>
          <Box
            as="button"
            disabled={page === 0}
            onClick={() => onPage(Math.max(0, page - 1))}
            sx={{
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 1,
              bg: 'canvas.default',
              color: page === 0 ? 'fg.subtle' : 'fg.default',
              cursor: page === 0 ? 'default' : 'pointer',
              px: '6px',
              py: '2px',
              fontFamily: 'inherit',
              fontSize: 0,
            }}
          >
            ←
          </Box>
          <Text sx={{ fontFamily: 'mono', fontSize: 0, minWidth: 40, textAlign: 'center' }}>
            {page + 1} / {pageCount}
          </Text>
          <Box
            as="button"
            disabled={page >= pageCount - 1}
            onClick={() => onPage(Math.min(pageCount - 1, page + 1))}
            sx={{
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 1,
              bg: 'canvas.default',
              color: page >= pageCount - 1 ? 'fg.subtle' : 'fg.default',
              cursor: page >= pageCount - 1 ? 'default' : 'pointer',
              px: '6px',
              py: '2px',
              fontFamily: 'inherit',
              fontSize: 0,
            }}
          >
            →
          </Box>
        </>
      )}
    </Box>
  );
}

/* =========================================================================
 * Reusable primitives
 * ========================================================================= */

function BackLink() {
  return (
    <Box>
      <Link href="/miners" prefetch={false} style={{ textDecoration: 'none' }}>
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            py: '4px',
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 1,
            color: 'fg.muted',
            fontSize: 1,
            cursor: 'pointer',
            '&:hover': { color: 'fg.default', borderColor: 'border.muted' },
          }}
        >
          <ArrowLeftIcon size={12} />
          Miners
        </Box>
      </Link>
    </Box>
  );
}

function EligibilityChip({ eligible, label }: { eligible: boolean; label: string }) {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        px: '8px',
        py: '3px',
        borderRadius: 999,
        border: '1px solid',
        borderColor: eligible ? 'success.emphasis' : 'border.muted',
        bg: eligible ? 'success.subtle' : 'canvas.inset',
        color: eligible ? 'success.fg' : 'fg.muted',
        fontSize: '10px',
        fontWeight: 800,
        letterSpacing: '0.6px',
        textTransform: 'uppercase',
      }}
    >
      <Box aria-hidden sx={{ width: 5, height: 5, borderRadius: 999, bg: eligible ? 'success.fg' : 'fg.muted' }} />
      {label}
    </Box>
  );
}

function HeroStat({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  accent: string;
}) {
  return (
    <Box
      sx={{
        p: 3,
        borderRight: ['none', null, '1px solid var(--border-muted)'],
        borderTop: ['1px solid var(--border-muted)', null, 'none'],
        '&:nth-of-type(2n+1)': {
          borderRight: ['1px solid var(--border-muted)', null, '1px solid var(--border-muted)'],
        },
        '&:nth-of-type(1), &:nth-of-type(2)': { borderTop: 'none' },
        '&:last-of-type': { borderRight: 'none' },
        minWidth: 0,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          fontSize: '10px',
          color: 'fg.muted',
          fontWeight: 700,
          letterSpacing: '1px',
          textTransform: 'uppercase',
        }}
      >
        <Box sx={{ color: accent, display: 'inline-flex' }}>{icon}</Box>
        {label}
      </Box>
      <Text
        sx={{
          display: 'block',
          fontFamily: 'mono',
          fontVariantNumeric: 'tabular-nums',
          fontSize: [3, null, 4],
          fontWeight: 800,
          letterSpacing: '-0.03em',
          color: accent,
          lineHeight: 1.1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </Text>
      <Text
        sx={{
          display: 'block',
          fontSize: 0,
          color: 'fg.muted',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {sub}
      </Text>
    </Box>
  );
}

interface TabOption<K extends string> { key: K; label: string; icon?: React.ReactNode }

function Tabs<K extends string>({
  options,
  value,
  onChange,
}: {
  options: TabOption<K>[];
  value: K;
  onChange: (k: K) => void;
}) {
  const activeIndex = Math.max(0, options.findIndex((o) => o.key === value));
  return (
    <Box
      role="tablist"
      sx={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: `repeat(${options.length}, minmax(48px, 1fr))`,
        padding: '2px',
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'border.default',
        bg: 'canvas.default',
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          top: '2px',
          bottom: '2px',
          left: '2px',
          width: `calc((100% - 4px) / ${options.length})`,
          borderRadius: 1,
          bg: 'var(--bg-emphasis)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.18), 0 0 0 1px var(--border-strong)',
          transform: `translateX(${activeIndex * 100}%)`,
          transition: 'transform 240ms cubic-bezier(0.4, 0, 0.2, 1)',
          pointerEvents: 'none',
        }}
      />
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <Box
            as="button"
            key={opt.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.key)}
            sx={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              px: 2,
              py: '4px',
              border: 'none',
              borderRadius: 1,
              bg: 'transparent',
              color: active ? 'fg.default' : 'fg.muted',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 1,
              fontWeight: active ? 700 : 500,
              transition: 'color 180ms ease',
              whiteSpace: 'nowrap',
              '&:hover': { color: 'fg.default' },
            }}
          >
            {opt.icon}
            {opt.label}
          </Box>
        );
      })}
    </Box>
  );
}

/* =========================================================================
 * Stat cards
 * ========================================================================= */

interface StatTone { fg: string; bg: string }
const TONES: Record<string, StatTone> = {
  neutral: { fg: 'var(--fg-default)', bg: 'transparent' },
  success: { fg: 'var(--success-fg)', bg: 'transparent' },
  warn: { fg: 'var(--attention-emphasis)', bg: 'transparent' },
  danger: { fg: 'var(--danger-fg)', bg: 'transparent' },
  accent: { fg: 'var(--accent-fg)', bg: 'transparent' },
};

function StatCard({
  icon,
  label,
  value,
  sub,
  tone = 'neutral',
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: keyof typeof TONES;
  loading?: boolean;
}) {
  const t = TONES[tone];
  return (
    <Box
      sx={{
        position: 'relative',
        overflow: 'hidden',
        p: '12px',
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: '2px',
        minWidth: 0,
        transition: 'border-color 100ms, transform 120ms',
        '&:hover': {
          borderColor: 'border.muted',
        },
      }}
    >
      {/* Subtle tone accent strip on top */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          left: 0, top: 0, right: 0,
          height: '2px',
          bg: t.fg,
          opacity: 0.6,
        }}
      />
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          fontSize: '10px',
          color: 'fg.muted',
          fontWeight: 700,
          letterSpacing: '0.8px',
          textTransform: 'uppercase',
        }}
      >
        <Box sx={{ color: t.fg, display: 'inline-flex' }}>{icon}</Box>
        {label}
      </Box>
      <Text
        sx={{
          fontFamily: 'mono',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 800,
          fontSize: 4,
          letterSpacing: '-0.03em',
          color: loading ? 'fg.muted' : t.fg,
          lineHeight: 1.1,
          mt: '2px',
        }}
      >
        {loading ? '—' : value}
      </Text>
      {sub && (
        <Text sx={{ fontSize: 0, color: 'fg.muted', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sub}
        </Text>
      )}
    </Box>
  );
}

function OssStats({
  agg,
  earningsPerDay,
  eligible,
}: {
  agg: ReturnType<typeof useMemo> extends never ? never : {
    total: number; merged: number; open: number; closed: number;
    realScoreSum: number; actualScoreSum: number; collateralSum: number;
    additions: number; deletions: number; predictedUsd: number; uniqueRepos: number;
  };
  earningsPerDay: number;
  eligible: boolean;
}) {
  const earnings = formatUsd(earningsPerDay, { style: 'compact' });
  const earningsSub = eligible ? 'eligible · /day' : 'ineligible · /day';

  const scoreDisplay = agg.realScoreSum > 0
    ? agg.realScoreSum.toFixed(2)
    : agg.collateralSum > 0
      ? agg.collateralSum.toFixed(2)
      : '0';
  const scoreSub = agg.realScoreSum > 0
    ? `${agg.actualScoreSum.toFixed(2)} live`
    : agg.collateralSum > 0
      ? 'collateral staked'
      : '—';
  const mergeRate = agg.total > 0 ? Math.round((agg.merged / agg.total) * 100) : 0;

  return (
    <Box
      sx={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: [
          'repeat(2, minmax(0, 1fr))',
          null,
          'repeat(3, minmax(0, 1fr))',
        ],
        gridAutoRows: '1fr',
        gap: 2,
      }}
    >
      <StatCard
        icon={<ZapIcon size={11} />}
        label="Earnings"
        value={earnings}
        sub={earningsSub}
        tone="success"
      />
      <StatCard
        icon={<TrophyIcon size={11} />}
        label="Score"
        value={scoreDisplay}
        sub={scoreSub}
        tone="warn"
      />
      <StatCard
        icon={<GitPullRequestIcon size={11} />}
        label="Total PRs"
        value={agg.total.toLocaleString()}
        sub={`${agg.uniqueRepos} repo${agg.uniqueRepos === 1 ? '' : 's'}`}
        tone="neutral"
      />
      <StatCard
        icon={<GitMergeIcon size={11} />}
        label="Merged"
        value={agg.merged.toLocaleString()}
        sub={agg.total > 0 ? `${mergeRate}% merge rate` : '—'}
        tone="success"
      />
      <StatCard
        icon={<GitPullRequestIcon size={11} />}
        label="Open"
        value={agg.open.toLocaleString()}
        sub={agg.open > 0 ? 'in review' : 'none open'}
        tone="accent"
      />
      <StatCard
        icon={<GitPullRequestClosedIcon size={11} />}
        label="Closed"
        value={agg.closed.toLocaleString()}
        sub={agg.closed > 0 ? 'unmerged' : '—'}
        tone="danger"
      />
    </Box>
  );
}

function DiscoveryStats({
  agg,
  issueScore,
  earningsPerDay,
  minerTotals,
  period,
  eligible,
}: {
  agg: {
    total: number;
    solved: number;
    completed: number;
    open: number;
    closed: number;
    solvedExternal: number;
    uniqueRepos: number;
  };
  issueScore: number;
  earningsPerDay: number;
  minerTotals: { solved: number; validSolved: number; open: number; closed: number };
  period: Period;
  eligible: boolean;
}) {
  const earnings = formatUsd(earningsPerDay, { style: 'compact' });
  const earningsSub = eligible ? 'eligible · /day' : 'ineligible · /day';

  // For All-time, prefer authoritative miner totals (upstream-counted) over
  // the local-DB subset which only covers cached repos.
  const useTotals = period === 'ALL';
  const totalIssues = useTotals
    ? minerTotals.solved + minerTotals.open + minerTotals.closed
    : agg.total;
  const solvedDisplay = useTotals ? minerTotals.solved : agg.solved + agg.completed;
  const openDisplay = useTotals ? minerTotals.open : agg.open;
  const closedDisplay = useTotals ? minerTotals.closed : agg.closed;

  // Score display: real issueDiscoveryScore if non-zero; otherwise notice
  // that the miner is ineligible.
  const scoreDisplay = issueScore > 0 ? issueScore.toFixed(2) : '0';
  const scoreSub = issueScore > 0
    ? 'discovery score'
    : eligible ? 'no emission yet' : 'ineligible';

  const solveRate = totalIssues > 0 ? Math.round((solvedDisplay / totalIssues) * 100) : 0;

  return (
    <Box
      sx={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: [
          'repeat(2, minmax(0, 1fr))',
          null,
          'repeat(3, minmax(0, 1fr))',
        ],
        gridAutoRows: '1fr',
        gap: 2,
      }}
    >
      <StatCard
        icon={<ZapIcon size={11} />}
        label="Earnings"
        value={earnings}
        sub={earningsSub}
        tone="success"
      />
      <StatCard
        icon={<TrophyIcon size={11} />}
        label="Score"
        value={scoreDisplay}
        sub={scoreSub}
        tone="warn"
      />
      <StatCard
        icon={<IssueOpenedIcon size={11} />}
        label="Total Issues"
        value={totalIssues.toLocaleString()}
        sub={useTotals ? 'lifetime' : `${agg.uniqueRepos} repo${agg.uniqueRepos === 1 ? '' : 's'}`}
        tone="neutral"
      />
      <StatCard
        icon={<IssueClosedIcon size={11} />}
        label="Solved"
        value={solvedDisplay.toLocaleString()}
        sub={totalIssues > 0 ? `${solveRate}% solve rate` : '—'}
        tone="success"
      />
      <StatCard
        icon={<IssueOpenedIcon size={11} />}
        label="Open"
        value={openDisplay.toLocaleString()}
        sub={openDisplay > 0 ? 'in progress' : '—'}
        tone="accent"
      />
      <StatCard
        icon={<SkipIcon size={11} />}
        label="Closed"
        value={closedDisplay.toLocaleString()}
        sub={closedDisplay > 0 ? 'not planned' : '—'}
        tone="danger"
      />
    </Box>
  );
}

/* =========================================================================
 * Activity heatmap — GitHub-style contribution calendar grid
 * ========================================================================= */

/* Day-level count map: ISO date string → count of mode-active events. */
function buildDayMap({
  prs,
  discovered,
  solved,
  mode,
}: {
  prs: PrDetail[];
  discovered: IssueDetail[];
  solved: IssueDetail[];
  mode: Mode;
}): Map<string, number> {
  const map = new Map<string, number>();
  const add = (iso: string | null | undefined) => {
    if (!iso) return;
    const d = iso.slice(0, 10);
    if (!d || d.length < 10) return;
    map.set(d, (map.get(d) ?? 0) + 1);
  };
  if (mode === 'oss') {
    for (const p of prs) add(p.prCreatedAt);
  } else {
    for (const i of discovered) add(i.createdAt);
    for (const i of solved) add(i.closedAt ?? i.createdAt);
  }
  return map;
}

/* Build the week × day grid for the GitHub calendar.
 * Returns `weeks` (oldest first): each week is 7 Day cells (Sun→Sat).
 * `numWeeks` reflects the chosen period. */
interface DayCell {
  date: string; // YYYY-MM-DD
  count: number;
  inPeriod: boolean; // whether the cell falls within the requested period
}

function buildCalendarGrid(
  dayMap: Map<string, number>,
  period: Period,
): { weeks: DayCell[][]; monthLabels: { col: number; label: string }[] } {
  // Always anchor the grid end to today's week. The number of columns
  // shown depends on the period selection.
  const numWeeks = period === '1D' ? 5 : period === '7D' ? 5 : period === '35D' ? 5 : 26;
  const periodDays = period === '1D' ? 1 : period === '7D' ? 7 : period === '35D' ? 35 : null;

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  // Find the Sunday that ends this grid (next Sunday or today if Sunday).
  const endSunday = new Date(now);
  const dow = endSunday.getDay(); // 0 = Sun
  endSunday.setDate(endSunday.getDate() + (dow === 0 ? 0 : 7 - dow));
  endSunday.setHours(0, 0, 0, 0);

  const startSunday = new Date(endSunday);
  startSunday.setDate(startSunday.getDate() - numWeeks * 7);

  // Period cutoff
  const cutoffMs = periodDays != null
    ? now.getTime() - periodDays * 24 * 60 * 60 * 1000
    : -Infinity;

  const weeks: DayCell[][] = [];
  const monthLabels: { col: number; label: string }[] = [];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  let prevMonth = -1;
  for (let w = 0; w < numWeeks; w++) {
    const week: DayCell[] = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(startSunday);
      dt.setDate(dt.getDate() + w * 7 + d);
      const dateStr = dt.toISOString().slice(0, 10);
      const inFuture = dateStr > todayStr;
      const inPeriod = !inFuture && dt.getTime() >= cutoffMs;
      week.push({
        date: dateStr,
        count: inFuture ? 0 : (dayMap.get(dateStr) ?? 0),
        inPeriod,
      });
      // Track month label changes (show on the first week where a new month starts)
      if (!inFuture && dt.getMonth() !== prevMonth) {
        prevMonth = dt.getMonth();
        monthLabels.push({ col: w, label: MONTHS[dt.getMonth()] });
      }
    }
    weeks.push(week);
  }
  return { weeks, monthLabels };
}

function cellColor(count: number, max: number, primaryColor: string, inPeriod: boolean): string {
  if (!inPeriod) return 'var(--bgColor-muted, var(--color-canvas-inset))';
  if (count === 0) return 'var(--bgColor-neutral-muted, var(--color-neutral-muted))';
  // 4 intensity levels like GitHub
  const pct = max > 0 ? count / max : 0;
  if (pct <= 0.25) return primaryColor.replace(')', ', 0.35)').replace('var(', 'color-mix(in srgb, ').replace(')', ' 35%, transparent)');
  if (pct <= 0.5) return primaryColor.replace(')', ', 0.55)').replace('var(', 'color-mix(in srgb, ').replace(')', ' 55%, transparent)');
  if (pct <= 0.75) return primaryColor.replace(')', ', 0.75)').replace('var(', 'color-mix(in srgb, ').replace(')', ' 75%, transparent)');
  return primaryColor;
}

// Simpler intensity levels using inline opacity trick
function getCellStyle(count: number, max: number, inPeriod: boolean, primaryCssVar: string): React.CSSProperties {
  if (!inPeriod) return { backgroundColor: 'var(--bgColor-muted, var(--color-canvas-inset, #161b22))' };
  if (count === 0) return { backgroundColor: 'var(--bgColor-neutral-muted, var(--color-neutral-muted, #21262d))' };
  const pct = max > 0 ? count / max : 1;
  // Map to 4 opacity tiers
  const opacity = pct <= 0.25 ? 0.3 : pct <= 0.5 ? 0.55 : pct <= 0.75 ? 0.78 : 1;
  return { backgroundColor: primaryCssVar, opacity };
}

function ActivityHeatmap({
  prs,
  discovered,
  solved,
  period,
  mode,
}: {
  prs: PrDetail[];
  discovered: IssueDetail[];
  solved: IssueDetail[];
  period: Period;
  mode: Mode;
}) {
  const dayMap = useMemo(
    () => buildDayMap({ prs, discovered, solved, mode }),
    [prs, discovered, solved, mode],
  );

  const { weeks, monthLabels } = useMemo(
    () => buildCalendarGrid(dayMap, period),
    [dayMap, period],
  );

  const totalInPeriod = useMemo(() => {
    let sum = 0;
    for (const week of weeks) for (const cell of week) if (cell.inPeriod) sum += cell.count;
    return sum;
  }, [weeks]);

  const max = useMemo(() => {
    let m = 0;
    for (const week of weeks) for (const cell of week) if (cell.count > m) m = cell.count;
    return Math.max(1, m);
  }, [weeks]);

  const primaryCssVar = mode === 'oss' ? 'var(--accent-fg)' : 'var(--done-emphasis)';
  const primaryLabel = mode === 'oss' ? 'Pull Requests' : 'Issues';

  const title =
    period === '1D' ? 'Activity · last 24 hours'
    : period === '7D' ? 'Activity · last 7 days'
    : period === '35D' ? 'Activity · last 35 days'
    : 'Activity · last 6 months';

  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const CELL_SIZE = 11;
  const CELL_GAP = 3;

  return (
    <Box
      sx={{
        flex: 1,
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
        p: 3,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 0,
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Text sx={{ fontSize: 1, fontWeight: 700, letterSpacing: '-0.005em' }}>{title}</Text>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: 0 }}>
          <Text sx={{ color: 'fg.muted' }}>{totalInPeriod} {primaryLabel}</Text>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
            <Text sx={{ fontSize: '10px', color: 'fg.muted' }}>Less</Text>
            {[0, 0.25, 0.55, 0.78, 1].map((op, i) => (
              <Box
                key={i}
                sx={{ width: CELL_SIZE, height: CELL_SIZE, borderRadius: '50%' }}
                style={{
                  backgroundColor: op === 0 ? 'var(--bgColor-neutral-muted, var(--color-neutral-muted, #21262d))' : primaryCssVar,
                  opacity: op === 0 ? 1 : op,
                }}
              />
            ))}
            <Text sx={{ fontSize: '10px', color: 'fg.muted' }}>More</Text>
          </Box>
        </Box>
      </Box>

      {/* Calendar grid with day-of-week labels */}
      <Box sx={{ overflowX: 'auto', overflowY: 'hidden' }}>
        <Box sx={{ display: 'inline-flex', gap: '4px', alignItems: 'flex-start' }}>
          {/* Day-of-week label column */}
          <Box
            sx={{ display: 'flex', flexDirection: 'column', gap: `${CELL_GAP}px`, mr: '2px', flexShrink: 0 }}
            style={{ paddingTop: 18 }} // space for month labels row
          >
            {DAY_LABELS.map((d, i) => (
              <Box
                key={d}
                sx={{ height: CELL_SIZE, display: 'flex', alignItems: 'center' }}
              >
                <Text
                  sx={{ fontSize: '9px', color: 'fg.subtle', fontFamily: 'mono', lineHeight: 1, whiteSpace: 'nowrap' }}
                  style={{ visibility: i % 2 === 1 ? 'visible' : 'hidden' }}
                >
                  {d}
                </Text>
              </Box>
            ))}
          </Box>

          {/* Weeks + month labels */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {/* Month label row */}
            <Box sx={{ display: 'flex', height: 18, position: 'relative' }} style={{ width: weeks.length * (CELL_SIZE + CELL_GAP) }}>
              {monthLabels.map((ml) => (
                <Text
                  key={ml.col + ml.label}
                  sx={{ fontSize: '9px', color: 'fg.muted', fontFamily: 'mono', position: 'absolute', top: 0, whiteSpace: 'nowrap' }}
                  style={{ left: ml.col * (CELL_SIZE + CELL_GAP) }}
                >
                  {ml.label}
                </Text>
              ))}
            </Box>

            {/* The grid: one column per week, 7 cells per column */}
            <Box sx={{ display: 'flex', gap: `${CELL_GAP}px` }}>
              {weeks.map((week, wi) => (
                <Box key={wi} sx={{ display: 'flex', flexDirection: 'column', gap: `${CELL_GAP}px` }}>
                  {week.map((cell, di) => (
                    <Box
                      key={cell.date}
                      title={cell.inPeriod ? `${cell.date}: ${cell.count} ${primaryLabel}` : cell.date}
                      sx={{ width: CELL_SIZE, height: CELL_SIZE, borderRadius: '50%', flexShrink: 0 }}
                      style={getCellStyle(cell.count, max, cell.inPeriod, primaryCssVar)}
                    />
                  ))}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

/* =========================================================================
 * Code Impact card
 * ========================================================================= */

function CodeImpactCard({
  prAgg,
  miner,
}: {
  prAgg: { additions: number; deletions: number; uniqueRepos: number; total: number };
  miner: MinerProfile | undefined;
}) {
  const totalChanged = prAgg.additions + prAgg.deletions;
  const net = prAgg.additions - prAgg.deletions;
  const ratio = totalChanged > 0 ? Math.round((prAgg.additions / totalChanged) * 100) : 0;
  const lifetimeAdded = miner?.totalAdditions ?? 0;
  const lifetimeDeleted = miner?.totalDeletions ?? 0;
  const lifetimeNet = lifetimeAdded - lifetimeDeleted;

  // GitHub-style 5-segment diff pill
  const SEGS = 5;
  const greenSegs = totalChanged > 0
    ? Math.min(SEGS, Math.max(prAgg.additions > 0 ? 1 : 0, Math.round((prAgg.additions / totalChanged) * SEGS)))
    : 0;

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        overflow: 'hidden',
        bg: 'canvas.subtle',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 3, py: 2,
          bg: 'canvas.default',
          borderBottom: '1px solid', borderColor: 'border.muted',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ color: 'fg.muted', display: 'flex' }}><ZapIcon size={14} /></Box>
          <Text sx={{ fontSize: 1, fontWeight: 700 }}>Code Impact</Text>
        </Box>
        <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
          {prAgg.uniqueRepos} repo{prAgg.uniqueRepos === 1 ? '' : 's'} · {prAgg.total} PR{prAgg.total === 1 ? '' : 's'} this window
        </Text>
      </Box>

      {/* Three stat columns: Added | Removed | Net */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: ['1fr 1fr', null, '1fr 1fr 1fr'],
          borderBottom: '1px solid', borderColor: 'border.muted',
        }}
      >
        {/* Added */}
        <Box sx={{ px: 3, py: 3, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Box sx={{ color: 'var(--success-fg)', display: 'flex', opacity: 0.8 }}><DiffAddedIcon size={12} /></Box>
            <Text sx={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'fg.muted' }}>
              Added
            </Text>
          </Box>
          <Text
            sx={{
              fontFamily: 'mono', fontVariantNumeric: 'tabular-nums',
              fontWeight: 800, fontSize: 4, lineHeight: 1,
              letterSpacing: '-0.03em', color: 'var(--success-fg)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            +{prAgg.additions.toLocaleString()}
          </Text>
          <Text sx={{ fontSize: '10px', color: 'fg.subtle' }}>lines</Text>
        </Box>

        {/* Removed */}
        <Box
          sx={{
            px: 3, py: 3, display: 'flex', flexDirection: 'column', gap: '6px',
            borderLeft: '1px solid', borderLeftColor: 'border.muted',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Box sx={{ color: 'var(--danger-fg)', display: 'flex', opacity: 0.8 }}><DiffRemovedIcon size={12} /></Box>
            <Text sx={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'fg.muted' }}>
              Removed
            </Text>
          </Box>
          <Text
            sx={{
              fontFamily: 'mono', fontVariantNumeric: 'tabular-nums',
              fontWeight: 800, fontSize: 4, lineHeight: 1,
              letterSpacing: '-0.03em', color: 'var(--danger-fg)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            −{prAgg.deletions.toLocaleString()}
          </Text>
          <Text sx={{ fontSize: '10px', color: 'fg.subtle' }}>lines</Text>
        </Box>

        {/* Net change — hidden on mobile (2-col) to keep it clean */}
        <Box
          sx={{
            px: 3, py: 3, display: ['none', null, 'flex'], flexDirection: 'column', gap: '6px',
            borderLeft: '1px solid', borderLeftColor: 'border.muted',
          }}
        >
          <Text sx={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'fg.muted' }}>
            Net Change
          </Text>
          <Text
            sx={{
              fontFamily: 'mono', fontVariantNumeric: 'tabular-nums',
              fontWeight: 800, fontSize: 4, lineHeight: 1,
              letterSpacing: '-0.03em',
              color: net >= 0 ? 'var(--success-fg)' : 'var(--danger-fg)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {net >= 0 ? '+' : '−'}{Math.abs(net).toLocaleString()}
          </Text>
          <Text sx={{ fontSize: '10px', color: 'fg.subtle' }}>{net >= 0 ? 'more added' : 'more removed'}</Text>
        </Box>
      </Box>

      {/* Diff strip */}
      <Box sx={{ px: 3, py: '14px', display: 'flex', alignItems: 'center', gap: 3, borderBottom: '1px solid', borderColor: 'border.muted' }}>
        {/* 5-segment pill — identical to GitHub diff stat style */}
        <Box sx={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
          {Array.from({ length: SEGS }).map((_, i) => (
            <Box
              key={i}
              sx={{
                width: 10, height: 10, borderRadius: '2px',
                bg: totalChanged === 0
                  ? 'border.muted'
                  : i < greenSegs
                    ? 'var(--success-fg)'
                    : 'var(--danger-fg)',
                opacity: totalChanged === 0 ? 0.4 : i < greenSegs ? 0.85 : 0.7,
              }}
            />
          ))}
        </Box>

        {/* Ratio labels */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, minWidth: 0 }}>
          {totalChanged > 0 ? (
            <>
              <Text sx={{ fontSize: 0, color: 'var(--success-fg)', fontVariantNumeric: 'tabular-nums', fontFamily: 'mono', fontWeight: 600 }}>
                +{ratio}%
              </Text>
              <Text sx={{ fontSize: 0, color: 'fg.subtle' }}>/</Text>
              <Text sx={{ fontSize: 0, color: 'var(--danger-fg)', fontVariantNumeric: 'tabular-nums', fontFamily: 'mono', fontWeight: 600 }}>
                −{100 - ratio}%
              </Text>
              <Text sx={{ fontSize: 0, color: 'fg.muted', ml: 1 }}>
                · {totalChanged.toLocaleString()} lines changed
              </Text>
            </>
          ) : (
            <Text sx={{ fontSize: 0, color: 'fg.subtle' }}>No changes in this window</Text>
          )}
        </Box>
      </Box>

      {/* Lifetime footer */}
      <Box
        sx={{
          px: 3, py: 2,
          display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap',
        }}
      >
        <Text sx={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'fg.subtle', flexShrink: 0 }}>
          Lifetime
        </Text>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
          <Text sx={{ fontSize: 0, fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', color: 'var(--success-fg)', opacity: 0.65 }}>
            +{lifetimeAdded.toLocaleString()}
          </Text>
          <Text sx={{ fontSize: 0, fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', color: 'var(--danger-fg)', opacity: 0.65 }}>
            −{lifetimeDeleted.toLocaleString()}
          </Text>
          <Text sx={{ fontSize: 0, color: 'fg.subtle' }}>·</Text>
          <Text
            sx={{
              fontSize: 0, fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', opacity: 0.65,
              color: lifetimeNet >= 0 ? 'var(--success-fg)' : 'var(--danger-fg)',
            }}
          >
            net {lifetimeNet >= 0 ? '+' : '−'}{Math.abs(lifetimeNet).toLocaleString()}
          </Text>
          <Text sx={{ fontSize: 0, color: 'fg.muted', opacity: 0.6 }}>
            · {(miner?.uniqueReposCount ?? 0)} repo{(miner?.uniqueReposCount ?? 0) === 1 ? '' : 's'} lifetime
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

/* =========================================================================
 * Per-repo breakdown — wide table with expandable details
 * ========================================================================= */

interface RepoBucket {
  repo: string;
  prs: PrDetail[];
  merged: number;
  validPrs: number;      // merged PRs with tokenScore >= 5 (validator's eligibility criterion)
  predictedUsd: number;
  openPr: number;
  closedPr: number;
  realScore: number;
  actualScore: number;
  additions: number;
  deletions: number;
  discovered: IssueDetail[];
  solvedByPr: IssueDetail[];
  openIssue: number;
  solvedIssue: number;
  completedIssue: number;
  closedIssue: number;
}

// Eligibility thresholds — mirror constants.py defaults.
const OSS_MIN_VALID_PRS   = 3;
const OSS_MIN_CRED        = 0.80;
const DISC_MIN_VALID_SOLVED = 3;
const DISC_MIN_CRED       = 0.80;

function ossRepoEligible(r: RepoBucket): boolean {
  const cred = (r.merged + r.closedPr) > 0 ? r.merged / (r.merged + r.closedPr) : 0;
  return r.validPrs >= OSS_MIN_VALID_PRS && cred >= OSS_MIN_CRED;
}
function discRepoEligible(r: RepoBucket): boolean {
  const cred = (r.solvedIssue + r.closedIssue) > 0 ? r.solvedIssue / (r.solvedIssue + r.closedIssue) : 0;
  return r.solvedIssue >= DISC_MIN_VALID_SOLVED && cred >= DISC_MIN_CRED;
}

function makeRepoBucket(repo: string): RepoBucket {
  return {
    repo,
    prs: [],
    merged: 0,
    validPrs: 0,
    openPr: 0,
    closedPr: 0,
    realScore: 0,
    actualScore: 0,
    additions: 0,
    deletions: 0,
    predictedUsd: 0,
    discovered: [],
    solvedByPr: [],
    openIssue: 0,
    solvedIssue: 0,
    completedIssue: 0,
    closedIssue: 0,
  };
}

// Mode-aware column templates
// OSS:  Merged | Valid | Open | Closed | Credibility | Score | Earning  (7 cols)
// Disc: Solved | Valid | Open | Closed | Credibility | Score | Earning  (7 cols)
const REPO_COLS_OSS  = 'minmax(200px, 2fr) repeat(7, minmax(64px, 1fr))';
const REPO_COLS_DISC = 'minmax(200px, 2fr) repeat(7, minmax(64px, 1fr))';

function getSortValue(row: RepoBucket, col: string, mode: Mode): number {
  if (mode === 'oss') {
    switch (col) {
      case 'merged':   return row.merged;
      case 'valid':    return row.validPrs;
      case 'open':     return row.openPr;
      case 'closed':   return row.closedPr;
      case 'cred':     return (row.merged + row.closedPr) > 0 ? row.merged / (row.merged + row.closedPr) : 0;
      case 'score':    return row.realScore;
      case 'earning':  return row.predictedUsd;
      default:         return row.prs.length;
    }
  } else {
    switch (col) {
      case 'solved':  return row.solvedByPr.length;
      case 'valid':   return row.solvedIssue;
      case 'open':    return row.openIssue;
      case 'closed':  return row.closedIssue;
      case 'cred':    return (row.solvedIssue + row.closedIssue) > 0 ? row.solvedIssue / (row.solvedIssue + row.closedIssue) : 0;
      default:        return row.discovered.length + row.solvedByPr.length;
    }
  }
}

function RepoBreakdown({
  repos,
  selectedRepo,
  onSelectRepo,
  ossEligible,
  issueEligible,
  mode,
  ossEarningPerDay,
  discEarningPerDay,
  issueDiscoveryScore,
  repoEvalMap,
}: {
  repos: RepoBucket[];
  selectedRepo: string | null;
  onSelectRepo: (repo: string) => void;
  ossEligible: boolean;
  issueEligible: boolean;
  mode: Mode;
  ossEarningPerDay: number;
  discEarningPerDay: number;
  issueDiscoveryScore: number;
  repoEvalMap: Map<string, RepoEval>;
}) {
  const colTemplate = mode === 'oss' ? REPO_COLS_OSS : REPO_COLS_DISC;
  const eligible = mode === 'oss' ? ossEligible : issueEligible;

  const [sortCol, setSortCol] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sortedRepos = useMemo(() => {
    if (!sortCol) return repos;
    if (sortCol === 'repo') {
      const arr = [...repos];
      arr.sort((a, b) => {
        const cmp = a.repo.localeCompare(b.repo);
        return sortDir === 'asc' ? cmp : -cmp;
      });
      return arr;
    }
    const arr = [...repos];
    arr.sort((a, b) => {
      const av = getSortValue(a, sortCol, mode);
      const bv = getSortValue(b, sortCol, mode);
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return arr;
  }, [repos, sortCol, sortDir, mode]);

  const { search, setSearch, page, setPage, pageCount, filtered, paged } = useSearchPage(
    sortedRepos,
    (r, q) => r.repo.toLowerCase().includes(q),
    15,
  );

  const toggleSort = (col: string) => {
    if (col === sortCol) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
    setPage(0);
  };

  const repoIsOssEligible  = (r: RepoBucket) => repoEvalMap.get(r.repo.toLowerCase())?.isEligible       ?? ossRepoEligible(r);
  const repoIsDiscEligible = (r: RepoBucket) => repoEvalMap.get(r.repo.toLowerCase())?.isIssueEligible  ?? discRepoEligible(r);

  const sums = useMemo(() => {
    // Only eligible repos contribute to the earnings pool — non-eligible repos
    // have predictedUsd but the miner doesn't actually receive that money.
    const eligibleOssRepos  = repos.filter(repoIsOssEligible);
    const eligibleDiscRepos = repos.filter(repoIsDiscEligible);

    const rawEligiblePredUsd = eligibleOssRepos.reduce((s, r) => s + r.predictedUsd, 0);
    const ossEarningScale = rawEligiblePredUsd > 0 ? ossEarningPerDay / rawEligiblePredUsd : 0;

    const totalEligibleSolved = eligibleDiscRepos.reduce((s, r) => s + r.solvedIssue, 0);
    const discScoreScale   = totalEligibleSolved > 0 ? issueDiscoveryScore / totalEligibleSolved : 0;
    const discEarningScale = totalEligibleSolved > 0 ? discEarningPerDay   / totalEligibleSolved : 0;

    return {
      ossMerged:   repos.reduce((s, r) => s + r.merged, 0),
      ossValid:    repos.reduce((s, r) => s + r.validPrs, 0),
      ossOpen:     repos.reduce((s, r) => s + r.openPr, 0),
      ossClosed:   repos.reduce((s, r) => s + r.closedPr, 0),
      ossScore:    repos.reduce((s, r) => s + r.realScore, 0),
      ossEarning:  ossEarningPerDay,
      ossEarningScale,
      discTotal:   repos.reduce((s, r) => s + r.discovered.length, 0),
      discSolved:  repos.reduce((s, r) => s + r.solvedByPr.length, 0),
      discOpen:    repos.reduce((s, r) => s + r.openIssue, 0),
      discClosed:  repos.reduce((s, r) => s + r.closedIssue, 0),
      discScore:   issueDiscoveryScore,
      discEarning: discEarningPerDay,
      discScoreScale,
      discEarningScale,
    };
  }, [repos, ossEarningPerDay, discEarningPerDay, issueDiscoveryScore, repoEvalMap]);

  if (repos.length === 0) {
    return (
      <Box
        sx={{
          p: 4,
          textAlign: 'center',
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 2,
          bg: 'canvas.subtle',
          color: 'fg.muted',
        }}
      >
        <RepoIcon size={20} />
        <Text sx={{ display: 'block', mt: 2 }}>No repository activity in this window.</Text>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: eligible
          ? (mode === 'oss' ? 'success.muted' : 'done.muted')
          : 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
        overflow: 'hidden',
      }}
    >
      {/* Panel toolbar */}
      <Box
        sx={{
          px: 3,
          py: 2,
          borderBottom: '1px solid',
          borderColor: 'border.muted',
          bg: 'canvas.default',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
          <RepoIcon size={13} />
          <Text sx={{ fontSize: 1, fontWeight: 700 }}>Repository</Text>
        </Box>
        {selectedRepo && (
          <Text sx={{ fontSize: 0, color: 'accent.fg', fontWeight: 600 }}>· filtering ↓</Text>
        )}
        <Box sx={{ ml: 'auto', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <Paginator
            page={page}
            pageCount={pageCount}
            total={repos.length}
            filtered={filtered.length}
            onPage={setPage}
          />
          <SearchInput value={search} onChange={setSearch} placeholder="Filter repos…" />
        </Box>
      </Box>

      {/* Scrollable table */}
      <Box sx={{ overflowX: 'auto' }}>
        <Box sx={{ minWidth: mode === 'oss' ? 640 : 540 }}>

          {/* Column header row */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: colTemplate,
              borderBottom: '1px solid',
              borderColor: 'border.muted',
              bg: 'canvas.default',
            }}
          >
            <RepoColHdr align="left" onClick={() => toggleSort('repo')} active={sortCol === 'repo'} dir={sortDir}>Repository</RepoColHdr>
            {mode === 'oss' ? (
              <>
                <RepoColHdr onClick={() => toggleSort('merged')} active={sortCol === 'merged'} dir={sortDir}>Merged</RepoColHdr>
                <RepoColHdr onClick={() => toggleSort('valid')} active={sortCol === 'valid'} dir={sortDir}>Valid</RepoColHdr>
                <RepoColHdr onClick={() => toggleSort('open')} active={sortCol === 'open'} dir={sortDir}>Open</RepoColHdr>
                <RepoColHdr onClick={() => toggleSort('closed')} active={sortCol === 'closed'} dir={sortDir}>Closed</RepoColHdr>
                <RepoColHdr onClick={() => toggleSort('cred')} active={sortCol === 'cred'} dir={sortDir}>Credibility</RepoColHdr>
                <RepoColHdr onClick={() => toggleSort('score')} active={sortCol === 'score'} dir={sortDir}>Score</RepoColHdr>
                <RepoColHdr onClick={() => toggleSort('earning')} active={sortCol === 'earning'} dir={sortDir}>Earning</RepoColHdr>
              </>
            ) : (
              <>
                <RepoColHdr onClick={() => toggleSort('solved')} active={sortCol === 'solved'} dir={sortDir}>Solved</RepoColHdr>
                <RepoColHdr onClick={() => toggleSort('valid')} active={sortCol === 'valid'} dir={sortDir}>Valid</RepoColHdr>
                <RepoColHdr onClick={() => toggleSort('open')} active={sortCol === 'open'} dir={sortDir}>Open</RepoColHdr>
                <RepoColHdr onClick={() => toggleSort('closed')} active={sortCol === 'closed'} dir={sortDir}>Closed</RepoColHdr>
                <RepoColHdr onClick={() => toggleSort('cred')} active={sortCol === 'cred'} dir={sortDir}>Credibility</RepoColHdr>
                <RepoColHdr>Score</RepoColHdr>
                <RepoColHdr>Earning</RepoColHdr>
              </>
            )}
          </Box>

          {/* Data rows */}
          {paged.map((r) => (
            <RepoRow
              key={r.repo}
              row={r}
              isSelected={selectedRepo === r.repo}
              onSelect={() => onSelectRepo(r.repo)}
              mode={mode}
              colTemplate={colTemplate}
              ossEarningScale={sums.ossEarningScale}
              discScoreScale={sums.discScoreScale}
              discEarningScale={sums.discEarningScale}
              repoEval={repoEvalMap.get(r.repo.toLowerCase())}
            />
          ))}

          {filtered.length === 0 && (
            <Box sx={{ py: 4, textAlign: 'center', color: 'fg.muted', fontSize: 1 }}>
              No repositories match &quot;{search}&quot;
            </Box>
          )}

          {/* Sum row */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: colTemplate,
              borderTop: '2px solid',
              borderColor: 'border.default',
              bg: 'canvas.inset',
              px: 3,
              py: '8px',
              alignItems: 'center',
            }}
          >
            <Text
              sx={{
                fontSize: '10px',
                fontWeight: 800,
                letterSpacing: '0.6px',
                textTransform: 'uppercase',
                color: 'fg.muted',
              }}
            >
              {repos.length} repos
            </Text>
            {mode === 'oss' ? (
              <>
                <SumCell v={sums.ossMerged} color="var(--success-fg)" />
                <SumCell v={sums.ossValid} color="var(--done-emphasis)" />
                <SumCell v={sums.ossOpen} color="var(--accent-fg)" />
                <SumCell v={sums.ossClosed} color="var(--danger-fg)" />
                <SumCell v="—" />
                <SumCell v={sums.ossScore > 0 ? sums.ossScore.toFixed(1) : '—'} color="var(--attention-emphasis)" />
                <SumCell v={sums.ossEarning > 0 ? formatUsd(sums.ossEarning, { style: 'compact' }) : '—'} color="var(--success-fg)" />
              </>
            ) : (
              <>
                <SumCell v={sums.discSolved} color="var(--done-emphasis)" />
                <SumCell v="—" />
                <SumCell v={sums.discOpen} color="var(--accent-fg)" />
                <SumCell v={sums.discClosed} color="var(--danger-fg)" />
                <SumCell v="—" />
                <SumCell v={sums.discScore > 0 ? sums.discScore.toFixed(1) : '—'} color="var(--attention-emphasis)" />
                <SumCell v={sums.discEarning > 0 ? formatUsd(sums.discEarning, { style: 'compact' }) : '—'} color="var(--success-fg)" />
              </>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function RepoColHdr({
  children,
  align = 'right',
  onClick,
  active = false,
  dir,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  onClick?: () => void;
  active?: boolean;
  dir?: 'asc' | 'desc';
}) {
  if (!onClick) {
    return (
      <Text sx={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'fg.muted', textAlign: align, px: '4px', py: '6px' }}>
        {children}
      </Text>
    );
  }
  return (
    <Box
      as="button"
      onClick={onClick}
      sx={{
        fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase',
        color: active ? 'fg.default' : 'fg.muted', textAlign: align,
        px: '4px', py: '6px',
        display: 'flex', alignItems: 'center',
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        gap: '2px', cursor: 'pointer', border: 'none', bg: 'transparent',
        fontFamily: 'inherit', userSelect: 'none', width: '100%',
        '&:hover': { color: 'fg.default' },
      }}
    >
      {children}
      <Text sx={{ fontSize: '8px', lineHeight: '1', flexShrink: 0 }}>
        {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
      </Text>
    </Box>
  );
}

function SumCell({ v, color }: { v: string | number; color?: string }) {
  return (
    <Text
      sx={{
        fontFamily: 'mono',
        fontVariantNumeric: 'tabular-nums',
        fontSize: '11px',
        fontWeight: 700,
        color: color ?? 'fg.muted',
        textAlign: 'right',
        pr: '4px',
      }}
    >
      {typeof v === 'number' ? v.toLocaleString() : v}
    </Text>
  );
}

function RepoRow({
  row,
  isSelected,
  onSelect,
  mode,
  colTemplate,
  ossEarningScale,
  discScoreScale,
  discEarningScale,
  repoEval,
}: {
  row: RepoBucket;
  isSelected: boolean;
  onSelect: () => void;
  mode: Mode;
  colTemplate: string;
  ossEarningScale: number;
  discScoreScale: number;
  discEarningScale: number;
  repoEval: RepoEval | undefined;
}) {
  const [owner, name] = row.repo.split('/');
  // Use validator-provided eligibility when available; fall back to local approximation.
  const isEligible = repoEval
    ? (mode === 'oss' ? repoEval.isEligible : repoEval.isIssueEligible)
    : (mode === 'oss' ? ossRepoEligible(row) : discRepoEligible(row));
  // Use validator-provided credibility when available; fall back to local calculation.
  const credPct = repoEval
    ? Math.round((mode === 'oss' ? repoEval.credibility : repoEval.issueCredibility) * 100)
    : (() => {
        const credOss = (row.merged + row.closedPr) > 0
          ? Math.round((row.merged / (row.merged + row.closedPr)) * 100) : null;
        const credDisc = (row.solvedIssue + row.closedIssue) > 0
          ? Math.round((row.solvedIssue / (row.solvedIssue + row.closedIssue)) * 100) : null;
        return mode === 'oss' ? credOss : credDisc;
      })();

  return (
    <Box
      as="button"
      onClick={onSelect}
      sx={{
        width: '100%',
        display: 'grid',
        gridTemplateColumns: colTemplate,
        alignItems: 'center',
        px: 3,
        py: '9px',
        border: 'none',
        borderBottom: '1px solid',
        borderColor: isEligible ? (mode === 'oss' ? 'success.muted' : 'done.muted') : 'border.muted',
        '&:last-of-type': { borderBottom: 'none' },
        boxShadow: isSelected ? 'inset 3px 0 0 var(--accent-fg)' : isEligible ? 'inset 3px 0 0 var(--success-fg)' : 'none',
        bg: isSelected ? 'accent.subtle' : isEligible ? 'success.subtle' : 'transparent',
        color: 'fg.default',
        textAlign: 'left',
        fontFamily: 'inherit',
        cursor: 'pointer',
        transition: 'background-color 100ms, box-shadow 100ms',
        '&:hover': { bg: isSelected ? 'accent.subtle' : isEligible ? 'success.subtle' : 'canvas.default' },
      }}
    >
      {/* Repo name */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, pr: 2 }}>
        <Box sx={{ color: isSelected ? 'accent.fg' : isEligible ? 'success.fg' : 'fg.muted', flexShrink: 0 }}>
          <RepoIcon size={12} />
        </Box>
        <Link
          href={`/repos/${owner}/${name}`}
          prefetch={false}
          onClick={(e) => e.stopPropagation()}
          style={{ textDecoration: 'none', minWidth: 0, overflow: 'hidden', flex: 1 }}
        >
          <Text
            sx={{
              fontSize: 0,
              fontWeight: isSelected ? 700 : 600,
              color: isSelected ? 'accent.fg' : 'fg.default',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'block',
              '&:hover': { color: 'accent.fg' },
            }}
          >
            {row.repo}
          </Text>
        </Link>
        {isEligible && (
          <Label
            variant={mode === 'oss' ? 'success' : 'done'}
            sx={{ fontSize: '9px', py: 0, px: '4px', flexShrink: 0, lineHeight: '16px' }}
          >
            Eligible
          </Label>
        )}
      </Box>

      {mode === 'oss' ? (
        <>
          <RepoCell v={row.merged} color={row.merged > 0 ? 'var(--success-fg)' : undefined} />
          <RepoCell v={row.validPrs} color={row.validPrs > 0 ? 'var(--done-emphasis)' : undefined} />
          <RepoCell v={row.openPr} color={row.openPr > 0 ? 'var(--accent-fg)' : undefined} />
          <RepoCell v={row.closedPr} color={row.closedPr > 0 ? 'var(--danger-fg)' : undefined} />
          <RepoCell v={credPct != null ? `${credPct}%` : '—'} color={credPct != null ? (credPct >= 50 ? 'var(--success-fg)' : 'var(--attention-emphasis)') : undefined} />
          <RepoCell v={isEligible && row.realScore > 0 ? row.realScore.toFixed(2) : '—'} color={isEligible && row.realScore > 0 ? 'var(--attention-emphasis)' : undefined} />
          {(() => {
            const norm = isEligible ? row.predictedUsd * ossEarningScale : 0;
            return <RepoCell v={norm > 0 ? formatUsd(norm, { style: 'compact' }) : '—'} color={norm > 0 ? 'var(--success-fg)' : undefined} />;
          })()}
        </>
      ) : (
        <>
          <RepoCell v={row.solvedByPr.length} color={row.solvedByPr.length > 0 ? 'var(--done-emphasis)' : undefined} />
          <RepoCell v={row.solvedIssue} color={row.solvedIssue > 0 ? 'var(--done-emphasis)' : undefined} />
          <RepoCell v={row.openIssue} color={row.openIssue > 0 ? 'var(--accent-fg)' : undefined} />
          <RepoCell v={row.closedIssue} color={row.closedIssue > 0 ? 'var(--danger-fg)' : undefined} />
          <RepoCell v={credPct != null ? `${credPct}%` : '—'} color={credPct != null ? (credPct >= 50 ? 'var(--success-fg)' : 'var(--attention-emphasis)') : undefined} />
          {(() => {
            const score = isEligible ? row.solvedIssue * discScoreScale : 0;
            return <RepoCell v={score > 0 ? score.toFixed(2) : '—'} color={score > 0 ? 'var(--attention-emphasis)' : undefined} />;
          })()}
          {(() => {
            const earn = isEligible ? row.solvedIssue * discEarningScale : 0;
            return <RepoCell v={earn > 0 ? formatUsd(earn, { style: 'compact' }) : '—'} color={earn > 0 ? 'var(--success-fg)' : undefined} />;
          })()}
        </>
      )}
    </Box>
  );
}

function RepoCell({ v, color }: { v: string | number; color?: string }) {
  return (
    <Text
      sx={{
        fontFamily: 'mono',
        fontVariantNumeric: 'tabular-nums',
        fontSize: '11px',
        fontWeight: 600,
        color: color ?? 'fg.muted',
        textAlign: 'right',
        pr: '4px',
      }}
    >
      {typeof v === 'number' ? v.toLocaleString() : v}
    </Text>
  );
}

/* =========================================================================
 * Time decay utility
 * ========================================================================= */

const DECAY_PARAMS = { graceHours: 12, midpoint: 10, steepness: 0.4, floor: 0.05 };

function decayAt(daysSinceCreated: number): number {
  const graceDays = DECAY_PARAMS.graceHours / 24;
  if (daysSinceCreated <= graceDays) return 1;
  const d = daysSinceCreated - graceDays;
  const raw = 1 / (1 + Math.exp(DECAY_PARAMS.steepness * (d - DECAY_PARAMS.midpoint)));
  return Math.max(DECAY_PARAMS.floor, raw);
}

/* =========================================================================
 * PR detail modal — shown on click instead of navigating to a separate page
 * ========================================================================= */

function PrModal({ pr, onClose }: { pr: PrDetail; onClose: () => void }) {
  const [owner, name] = pr.repository.split('/');
  const ghHref = `https://github.com/${owner}/${name}/pull/${pr.pullRequestNumber}`;

  const stateColor =
    pr.prState === 'MERGED' ? 'var(--success-fg)' :
    pr.prState === 'OPEN'   ? 'var(--accent-fg)'  : 'var(--danger-fg)';
  const StateIcon =
    pr.prState === 'MERGED' ? GitMergeIcon :
    pr.prState === 'OPEN'   ? GitPullRequestIcon  : GitPullRequestClosedIcon;

  const daysSinceCreated = Math.max(
    0,
    (Date.now() - Date.parse(pr.prCreatedAt)) / 86_400_000,
  );
  const decayValue = pr.timeDecayMultiplier ?? decayAt(daysSinceCreated);
  const decayPct   = Math.round(decayValue * 100);

  const dateLabel =
    pr.prState === 'MERGED' ? 'Merged' :
    pr.prState === 'CLOSED' ? 'Closed' : 'Opened';
  const dateValue =
    pr.prState === 'MERGED' && pr.mergedAt
      ? formatRelativeTime(pr.mergedAt)
      : formatRelativeTime(pr.prCreatedAt);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: ['flex-end', null, 'center'],
        justifyContent: 'center',
        p: [0, null, 3],
      }}
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <Box
        sx={{
          bg: 'canvas.default',
          borderRadius: ['12px 12px 0 0', null, 2],
          border: '1px solid',
          borderColor: 'border.default',
          maxWidth: 540,
          width: '100%',
          maxHeight: ['85vh', null, '90vh'],
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
        style={{ boxShadow: '0 24px 48px -12px rgba(0,0,0,0.55)' }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <Box
          sx={{
            px: 3, pt: 3, pb: 2,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 2,
            borderBottom: '1px solid',
            borderColor: 'border.muted',
            position: 'sticky',
            top: 0,
            bg: 'canvas.default',
            zIndex: 1,
          }}
        >
          <Box sx={{ color: stateColor, display: 'inline-flex', mt: '3px', flexShrink: 0 }}>
            <StateIcon size={16} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Text
              sx={{
                display: 'block',
                fontSize: 2,
                fontWeight: 700,
                color: 'fg.default',
                lineHeight: 1.3,
                letterSpacing: '-0.01em',
              }}
            >
              {pr.title}
            </Text>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mt: '4px', flexWrap: 'wrap' }}>
              <Text sx={{ fontFamily: 'mono', fontSize: 0, color: 'fg.muted' }}>
                {pr.repository}#{pr.pullRequestNumber}
              </Text>
              {pr.label && (
                <>
                  <Dot />
                  <Label variant="default" sx={{ fontSize: 0 }}>{pr.label}</Label>
                </>
              )}
            </Box>
          </Box>
          <Box
            as="button"
            onClick={onClose}
            aria-label="Close"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: '50%',
              bg: 'canvas.subtle',
              color: 'fg.muted',
              cursor: 'pointer',
              flexShrink: 0,
              transition: 'background-color 100ms, color 100ms',
              '&:hover': { bg: 'canvas.inset', color: 'fg.default' },
            }}
          >
            <XIcon size={12} />
          </Box>
        </Box>

        {/* ── Stats grid ── */}
        <Box
          sx={{
            px: 3,
            py: 2,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '8px',
            borderBottom: '1px solid',
            borderColor: 'border.muted',
          }}
        >
          <ModalStat
            label="Changes"
            value={
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontFamily: 'mono', fontSize: 1, fontWeight: 700 }}>
                <Text sx={{ color: 'var(--success-fg)' }}>+{pr.additions.toLocaleString()}</Text>
                <Text sx={{ color: 'fg.subtle', fontWeight: 400 }}>/</Text>
                <Text sx={{ color: 'var(--danger-fg)' }}>−{pr.deletions.toLocaleString()}</Text>
              </Box>
            }
            sub={`${pr.commitCount} commit${pr.commitCount !== 1 ? 's' : ''}`}
          />
          <ModalStat
            label="Score"
            value={pr.realScore > 0 ? pr.realScore.toFixed(3) : pr.collateralScore > 0 ? pr.collateralScore.toFixed(3) : '—'}
            sub={pr.earnedScore != null ? `${pr.earnedScore.toFixed(3)} earned` : pr.score > 0 ? `${pr.score.toFixed(3)} live` : 'pending'}
            valueColor="var(--attention-emphasis)"
          />
          <ModalStat
            label="$/Day"
            value={pr.predictedUsdPerDay > 0 ? formatUsd(pr.predictedUsdPerDay, { style: 'compact' }) : '—'}
            sub="predicted"
            valueColor={pr.predictedUsdPerDay > 0 ? 'var(--success-fg)' : undefined}
          />
          <ModalStat
            label={dateLabel}
            value={dateValue}
            sub={
              pr.prState === 'MERGED' && pr.mergedAt
                ? pr.mergedAt.slice(0, 10)
                : pr.prCreatedAt.slice(0, 10)
            }
            valueColor={stateColor}
          />
          <ModalStat
            label="Time Decay"
            value={`${decayPct}%`}
            sub={decayPct >= 80 ? 'fresh' : decayPct >= 40 ? 'aging' : 'stale'}
            valueColor={decayPct >= 80 ? 'var(--success-fg)' : decayPct >= 40 ? 'var(--attention-emphasis)' : 'var(--danger-fg)'}
          />
          <ModalStat
            label="State"
            value={pr.prState}
            sub={pr.prState === 'OPEN' ? 'in review' : pr.prState === 'MERGED' ? 'merged' : 'closed'}
            valueColor={stateColor}
          />
        </Box>

        {/* ── Time decay chart ── */}
        <Box sx={{ px: 3, pt: 2, pb: 1 }}>
          <Text
            sx={{
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.6px',
              textTransform: 'uppercase',
              color: 'fg.muted',
              mb: 1,
              display: 'block',
            }}
          >
            Time Decay Curve
          </Text>
          <MiniDecayChart daysSinceCreated={daysSinceCreated} currentDecay={decayValue} />
        </Box>

        {/* ── Footer action ── */}
        <Box sx={{ px: 3, py: 2, display: 'flex', justifyContent: 'center' }}>
          <Box
            as="a"
            href={ghHref}
            target="_blank"
            rel="noreferrer"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              px: 3,
              py: '8px',
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 2,
              bg: 'canvas.subtle',
              color: 'fg.default',
              fontSize: 1,
              fontWeight: 600,
              textDecoration: 'none',
              transition: 'background-color 100ms, border-color 100ms',
              '&:hover': { bg: 'canvas.inset', borderColor: 'border.muted' },
            }}
          >
            <MarkGithubIcon size={14} />
            View on GitHub
            <LinkExternalIcon size={12} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function ModalStat({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  valueColor?: string;
}) {
  return (
    <Box
      sx={{
        p: 2,
        border: '1px solid',
        borderColor: 'border.muted',
        borderRadius: 2,
        bg: 'canvas.subtle',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        minWidth: 0,
      }}
    >
      <Text
        sx={{
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '0.6px',
          textTransform: 'uppercase',
          color: 'fg.muted',
        }}
      >
        {label}
      </Text>
      <Box
        sx={{
          fontFamily: 'mono',
          fontWeight: 700,
          fontSize: 1,
          color: valueColor ?? 'fg.default',
          lineHeight: 1.2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </Box>
      {sub && (
        <Text
          sx={{
            fontSize: '10px',
            color: 'fg.subtle',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {sub}
        </Text>
      )}
    </Box>
  );
}

function MiniDecayChart({
  daysSinceCreated,
  currentDecay,
}: {
  daysSinceCreated: number;
  currentDecay: number;
}) {
  const VW = 480, VH = 88;
  const PL = 28, PR = 12, PT = 8, PB = 22;
  const innerW = VW - PL - PR;
  const innerH = VH - PT - PB;
  const DAYS_SHOWN = 30;
  const GRACE_DAYS = DECAY_PARAMS.graceHours / 24;

  const xScale = (d: number) => PL + Math.min(d / DAYS_SHOWN, 1) * innerW;
  const yScale = (v: number) => PT + (1 - v) * innerH;

  const N = 120;
  const pts: string[] = [];
  for (let i = 0; i <= N; i++) {
    const d = (i / N) * DAYS_SHOWN;
    pts.push(`${xScale(d).toFixed(1)},${yScale(decayAt(d)).toFixed(1)}`);
  }
  const curvePath = `M ${pts.join(' L ')}`;
  const fillPath = `${curvePath} L ${xScale(DAYS_SHOWN).toFixed(1)},${(PT + innerH).toFixed(1)} L ${PL},${(PT + innerH).toFixed(1)} Z`;

  const nowDays = Math.min(daysSinceCreated, DAYS_SHOWN);
  const nowX    = xScale(nowDays);
  const nowY    = yScale(Math.max(DECAY_PARAMS.floor, Math.min(1, currentDecay)));

  const xTicks = [0, 7, 14, 21, 30];

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      style={{ display: 'block', width: '100%', height: 'auto' }}
      aria-hidden
    >
      {/* Background */}
      <rect x={PL} y={PT} width={innerW} height={innerH} fill="var(--bgColor-muted, #0d1117)" rx={3} />

      {/* Grace period shading */}
      <rect
        x={PL} y={PT}
        width={xScale(GRACE_DAYS) - PL}
        height={innerH}
        fill="var(--success-subtle, rgba(35,134,54,0.12))"
      />

      {/* Y gridlines */}
      {[0, 0.25, 0.5, 0.75, 1.0].map((v) => (
        <line
          key={v}
          x1={PL} y1={yScale(v)} x2={PL + innerW} y2={yScale(v)}
          stroke="var(--borderColor-muted, #30363d)"
          strokeWidth={0.5}
        />
      ))}

      {/* Fill */}
      <path d={fillPath} fill="var(--accent-fg)" opacity={0.07} />

      {/* Curve */}
      <path
        d={curvePath}
        fill="none"
        stroke="var(--accent-fg)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Floor dashed line */}
      <line
        x1={PL} y1={yScale(DECAY_PARAMS.floor)}
        x2={PL + innerW} y2={yScale(DECAY_PARAMS.floor)}
        stroke="var(--attention-emphasis)"
        strokeWidth={0.75}
        strokeDasharray="3 3"
        opacity={0.4}
      />

      {/* "Now" vertical line */}
      {daysSinceCreated < DAYS_SHOWN && (
        <line
          x1={nowX} y1={PT} x2={nowX} y2={PT + innerH}
          stroke="var(--accent-fg)"
          strokeWidth={1}
          strokeDasharray="3 2"
          opacity={0.5}
        />
      )}

      {/* "Now" dot */}
      <circle cx={nowX} cy={nowY} r={4} fill="var(--accent-fg)" />
      <circle cx={nowX} cy={nowY} r={1.8} fill="white" />

      {/* X axis labels */}
      {xTicks.map((d) => (
        <text
          key={d}
          x={xScale(d)} y={VH - 5}
          fontSize={8}
          fill="var(--fgColor-muted, #8b949e)"
          textAnchor={d === 0 ? 'start' : d === 30 ? 'end' : 'middle'}
          fontFamily="monospace"
        >
          {d}d
        </text>
      ))}

      {/* Y axis labels */}
      {[0, 0.5, 1.0].map((v) => (
        <text
          key={v}
          x={PL - 4} y={yScale(v) + 3}
          fontSize={8}
          fill="var(--fgColor-muted, #8b949e)"
          textAnchor="end"
          fontFamily="monospace"
        >
          {Math.round(v * 100)}%
        </text>
      ))}
    </svg>
  );
}

/* =========================================================================
 * PR list (full)
 * ========================================================================= */

function PrList({ prs, loading, uid: _uid }: { prs: PrDetail[]; loading: boolean; uid: string }) {
  const [modalPr, setModalPr] = useState<PrDetail | null>(null);
  const { search, setSearch, page, setPage, pageCount, filtered, paged } = useSearchPage(
    prs,
    (pr, q) =>
      pr.title.toLowerCase().includes(q) ||
      pr.repository.toLowerCase().includes(q) ||
      String(pr.pullRequestNumber).includes(q),
    15,
  );

  if (loading) return <ListLoading label="Loading pull requests…" />;
  if (prs.length === 0) {
    return (
      <EmptyState icon={<GitPullRequestIcon size={20} />} text="No pull requests in this window." />
    );
  }
  return (
    <>
      <Box
        sx={{
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 2,
          bg: 'canvas.subtle',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            px: 3,
            py: 2,
            borderBottom: '1px solid',
            borderColor: 'border.muted',
            bg: 'canvas.default',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexWrap: 'wrap',
          }}
        >
          <GitPullRequestIcon size={13} />
          <Text sx={{ fontSize: 1, fontWeight: 700 }}>Pull Requests</Text>
          <Box sx={{ ml: 'auto', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <Paginator
              page={page}
              pageCount={pageCount}
              total={prs.length}
              filtered={filtered.length}
              onPage={setPage}
            />
            <SearchInput value={search} onChange={setSearch} placeholder="Search PRs…" />
          </Box>
        </Box>
        <Box>
          {paged.map((pr) => (
            <PrRow key={`${pr.repository}#${pr.pullRequestNumber}`} pr={pr} onOpen={() => setModalPr(pr)} />
          ))}
          {filtered.length === 0 && (
            <Box sx={{ py: 4, textAlign: 'center', color: 'fg.muted', fontSize: 1 }}>
              No pull requests match &quot;{search}&quot;
            </Box>
          )}
        </Box>
      </Box>
      {modalPr && <PrModal pr={modalPr} onClose={() => setModalPr(null)} />}
    </>
  );
}

function PrRow({ pr, onOpen }: { pr: PrDetail; onOpen: () => void }) {
  const [owner, name] = pr.repository.split('/');
  const ghHref = `https://github.com/${owner}/${name}/pull/${pr.pullRequestNumber}`;
  const stateColor =
    pr.prState === 'MERGED' ? 'var(--success-fg)' :
    pr.prState === 'OPEN' ? 'var(--open-fg)' : 'var(--danger-fg)';
  const StateIcon =
    pr.prState === 'MERGED' ? GitMergeIcon :
    pr.prState === 'OPEN' ? GitPullRequestIcon : GitPullRequestClosedIcon;
  const scoreDisplay = pr.realScore > 0
    ? pr.realScore.toFixed(2)
    : pr.collateralScore > 0
      ? pr.collateralScore.toFixed(2)
      : '—';
  const scoreSub = pr.realScore > 0
    ? (pr.score > 0 ? `${pr.score.toFixed(2)} live` : 'pending')
    : pr.collateralScore > 0 ? 'collateral' : '—';

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: ['auto 1fr auto', null, 'auto minmax(0, 1fr) auto auto auto auto auto'],
        alignItems: 'center',
        gap: [2, null, 3],
        px: 3,
        py: '10px',
        borderBottom: '1px solid',
        borderColor: 'border.muted',
        '&:last-of-type': { borderBottom: 'none' },
        '&:hover': { bg: 'canvas.default' },
      }}
    >
      <Box sx={{ color: stateColor, display: 'inline-flex' }}>
        <StateIcon size={14} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Box
          as="button"
          onClick={onOpen}
          title={pr.title}
          sx={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            color: 'fg.default',
            fontSize: 1,
            fontWeight: 600,
            border: 'none',
            bg: 'transparent',
            fontFamily: 'inherit',
            cursor: 'pointer',
            p: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            '&:hover': { color: 'accent.fg' },
          }}
        >
          {pr.title}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mt: '2px', flexWrap: 'wrap' }}>
          <Text sx={{ fontSize: 0, color: 'fg.muted', fontFamily: 'mono' }}>
            {pr.repository}#{pr.pullRequestNumber}
          </Text>
          {pr.label && (
            <>
              <Dot />
              <Label variant="default" sx={{ fontSize: 0 }}>{pr.label}</Label>
            </>
          )}
        </Box>
      </Box>
      <Box sx={{ display: ['none', null, 'inline-flex'], alignItems: 'center', gap: 2, fontFamily: 'mono', fontSize: 0 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '2px', color: 'var(--success-fg)' }}>
          <DiffAddedIcon size={10} />
          {pr.additions.toLocaleString()}
        </Box>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '2px', color: 'var(--danger-fg)' }}>
          <DiffRemovedIcon size={10} />
          {pr.deletions.toLocaleString()}
        </Box>
      </Box>
      <Box sx={{ display: ['none', null, 'flex'], textAlign: 'right', flexDirection: 'column', minWidth: 70 }}>
        <Text sx={{ fontSize: '9px', color: 'fg.muted', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase' }}>
          Score
        </Text>
        <Text sx={{ fontFamily: 'mono', fontWeight: 700, color: 'var(--attention-emphasis)', fontSize: 1 }}>
          {scoreDisplay}
        </Text>
        <Text sx={{ fontSize: '9px', color: 'fg.subtle' }}>{scoreSub}</Text>
      </Box>
      <Box sx={{ display: ['none', null, 'flex'], textAlign: 'right', flexDirection: 'column', minWidth: 56 }}>
        <Text sx={{ fontSize: '9px', color: 'fg.muted', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase' }}>
          $/Day
        </Text>
        <Text sx={{ fontFamily: 'mono', fontWeight: 700, color: pr.predictedUsdPerDay > 0 ? 'var(--success-fg)' : 'var(--fg-muted)', fontSize: 1 }}>
          {pr.predictedUsdPerDay > 0 ? formatUsd(pr.predictedUsdPerDay, { style: 'compact' }) : '—'}
        </Text>
      </Box>
      <Box sx={{ display: ['none', null, 'flex'], textAlign: 'right', flexDirection: 'column', minWidth: 80 }}>
        <Text sx={{ fontSize: '9px', color: 'fg.muted', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase' }}>
          {pr.prState === 'MERGED' ? 'Merged' : 'Opened'}
        </Text>
        <Text sx={{ fontFamily: 'mono', fontSize: 0, color: pr.prState === 'MERGED' ? 'success.fg' : 'fg.default' }}>
          {pr.prState === 'MERGED' && pr.mergedAt
            ? formatRelativeTime(pr.mergedAt)
            : formatRelativeTime(pr.prCreatedAt)}
        </Text>
      </Box>
      <Box
        as="a"
        href={ghHref}
        target="_blank"
        rel="noreferrer"
        sx={{
          color: 'fg.muted',
          textDecoration: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          '&:hover': { color: 'fg.default' },
        }}
        aria-label="Open on GitHub"
      >
        <LinkExternalIcon size={12} />
      </Box>
    </Box>
  );
}


/* =========================================================================
 * Discovery lists (discovered + solved)
 * ========================================================================= */

function IssueList({
  issues,
  title,
  sub,
  kind,
  icon,
}: {
  issues: IssueDetail[];
  title: string;
  sub?: string;
  kind: 'discovered' | 'solved';
  icon: React.ReactNode;
}) {
  const { search, setSearch, page, setPage, pageCount, filtered, paged } = useSearchPage(
    issues,
    (iss, q) => iss.title.toLowerCase().includes(q) || iss.repo.toLowerCase().includes(q),
    15,
  );

  if (issues.length === 0) return null;

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: 3,
          py: 2,
          borderBottom: '1px solid',
          borderColor: 'border.muted',
          bg: 'canvas.default',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        {icon}
        <Text sx={{ fontSize: 1, fontWeight: 700 }}>{title}</Text>
        {sub && <Text sx={{ fontSize: 0, color: 'fg.muted' }}>· {sub}</Text>}
        <Box sx={{ ml: 'auto', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <Paginator
            page={page}
            pageCount={pageCount}
            total={issues.length}
            filtered={filtered.length}
            onPage={setPage}
          />
          <SearchInput value={search} onChange={setSearch} placeholder="Search issues…" />
        </Box>
      </Box>
      <Box>
        {paged.map((iss) => (
          <IssueRow key={`${kind}-${iss.repo}#${iss.number}`} iss={iss} kind={kind} />
        ))}
        {filtered.length === 0 && (
          <Box sx={{ py: 4, textAlign: 'center', color: 'fg.muted', fontSize: 1 }}>
            No issues match &quot;{search}&quot;
          </Box>
        )}
      </Box>
    </Box>
  );
}


function IssueRow({ iss, kind }: { iss: IssueDetail; kind: 'discovered' | 'solved' }) {
  const stateColor =
    iss.bucket === 'solved' ? 'var(--success-fg)' :
    iss.bucket === 'completed' ? 'var(--success-fg)' :
    iss.bucket === 'open' ? 'var(--open-fg)' : 'var(--danger-fg)';
  const StateIcon =
    iss.bucket === 'open' ? IssueOpenedIcon :
    iss.bucket === 'closed' ? SkipIcon : IssueClosedIcon;
  const stateLabel =
    iss.bucket === 'solved' ? 'Solved' :
    iss.bucket === 'completed' ? 'Completed' :
    iss.bucket === 'open' ? 'Open' : 'Closed';

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: ['auto 1fr auto', null, 'auto minmax(0, 1fr) auto auto auto'],
        alignItems: 'center',
        gap: [2, null, 3],
        px: 3,
        py: '10px',
        borderBottom: '1px solid',
        borderColor: 'border.muted',
        '&:last-of-type': { borderBottom: 'none' },
        '&:hover': { bg: 'canvas.default' },
      }}
    >
      <Box sx={{ color: stateColor, display: 'inline-flex' }}>
        <StateIcon size={14} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Box
          as="a"
          href={iss.htmlUrl ?? `https://github.com/${iss.repo}/issues/${iss.number}`}
          target="_blank"
          rel="noreferrer"
          sx={{
            display: 'block',
            color: 'fg.default',
            fontSize: 1,
            fontWeight: 600,
            textDecoration: 'none',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            '&:hover': { color: 'accent.fg', textDecoration: 'underline' },
          }}
          title={iss.title}
        >
          {iss.title}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mt: '2px', flexWrap: 'wrap' }}>
          <Text sx={{ fontSize: 0, color: 'fg.muted', fontFamily: 'mono' }}>
            {iss.repo}#{iss.number}
          </Text>
          {iss.comments > 0 && (
            <>
              <Dot />
              <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                <CommentDiscussionIcon size={10} />{iss.comments}
              </Text>
            </>
          )}
        </Box>
      </Box>
      <Box sx={{ display: ['none', null, 'flex'], textAlign: 'right', flexDirection: 'column', minWidth: 76 }}>
        <Text sx={{ fontSize: '9px', color: 'fg.muted', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase' }}>
          Status
        </Text>
        <Text sx={{ fontWeight: 700, fontSize: 0, color: stateColor }}>
          {stateLabel}
        </Text>
      </Box>
      <Box sx={{ display: ['none', null, 'flex'], textAlign: 'right', flexDirection: 'column', minWidth: 84 }}>
        <Text sx={{ fontSize: '9px', color: 'fg.muted', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase' }}>
          {iss.bucket === 'open' ? 'Opened' : 'Closed'}
        </Text>
        <Text sx={{ fontFamily: 'mono', fontSize: 0, color: iss.bucket === 'solved' || iss.bucket === 'completed' ? 'success.fg' : iss.bucket === 'open' ? 'fg.default' : 'fg.muted' }}>
          {iss.bucket !== 'open' && iss.closedAt
            ? formatRelativeTime(iss.closedAt)
            : formatRelativeTime(iss.createdAt)}
        </Text>
      </Box>
      <Box
        as="a"
        href={iss.htmlUrl ?? `https://github.com/${iss.repo}/issues/${iss.number}`}
        target="_blank"
        rel="noreferrer"
        sx={{
          color: 'fg.muted',
          textDecoration: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          '&:hover': { color: 'fg.default' },
        }}
        aria-label="Open on GitHub"
      >
        <LinkExternalIcon size={12} />
      </Box>
    </Box>
  );
}


/* =========================================================================
 * Misc shared primitives
 * ========================================================================= */

function ListHdr({
  icon,
  title,
  count,
  sub,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  sub?: string;
}) {
  return (
    <Box
      sx={{
        px: 3,
        py: 2,
        borderBottom: '1px solid',
        borderColor: 'border.muted',
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        bg: 'canvas.default',
      }}
    >
      {icon}
      <Text sx={{ fontSize: 1, fontWeight: 700 }}>{title}</Text>
      {sub && <Text sx={{ fontSize: 0, color: 'fg.muted' }}>· {sub}</Text>}
      <Text sx={{ fontSize: 0, color: 'fg.muted', ml: 'auto', fontFamily: 'mono' }}>
        {count.toLocaleString()}
      </Text>
    </Box>
  );
}

function Dot() {
  return <Text sx={{ fontSize: 0, color: 'fg.subtle' }}>·</Text>;
}

function EmptyState({
  icon,
  text,
  hint,
}: {
  icon: React.ReactNode;
  text: string;
  hint?: string;
}) {
  return (
    <Box
      sx={{
        p: 4,
        textAlign: 'center',
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
        color: 'fg.muted',
      }}
    >
      <Box sx={{ display: 'inline-flex', justifyContent: 'center', mb: 2 }}>{icon}</Box>
      <Text sx={{ display: 'block', fontWeight: 600 }}>{text}</Text>
      {hint && (
        <Text sx={{ display: 'block', fontSize: 0, color: 'fg.subtle', mt: 1, maxWidth: 420, mx: 'auto' }}>
          {hint}
        </Text>
      )}
    </Box>
  );
}

function ListLoading({ label }: { label: string }) {
  return (
    <Box
      sx={{
        p: 4,
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
        textAlign: 'center',
        color: 'fg.muted',
        fontSize: 1,
      }}
    >
      {label}
    </Box>
  );
}
