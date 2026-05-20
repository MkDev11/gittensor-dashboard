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
  CopyIcon,
  CheckIcon,
  CheckCircleIcon,
  CommentDiscussionIcon,
  XIcon,
  ZapIcon,
  TrophyIcon,
  TriangleDownIcon,
  TriangleUpIcon,
} from '@primer/octicons-react';
import { useTrackedMiners } from '@/lib/tracked-miners';
import { useMinerLogin } from '@/lib/use-miner';
import { formatUsd, formatRelativeTime } from '@/lib/format';
import {
  num, splitEarnings,
  EligibilityBadge, IntensityBar, SplitBar, CountCell,
  Card, CardHeader, Metric, Segmented, SearchBox, Pagination, RowSizeSelector, PageNav, EmptyState,
  MONO, LABEL,
} from '../parts';

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

type Period = '1D' | '7D' | '35D' | 'ALL';
type Mode = 'oss' | 'discovery';

const PERIODS: { key: Period; label: string; days: number | null }[] = [
  { key: '1D',  label: '1D',  days: 1 },
  { key: '7D',  label: '7D',  days: 7 },
  { key: '35D', label: '35D', days: 35 },
  { key: 'ALL', label: 'All', days: null },
];

function withinPeriod(iso: string | null | undefined, days: number | null): boolean {
  if (days === null) return true;
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < days * 24 * 60 * 60 * 1000;
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
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);

  const { data, isError } = useQuery<DetailResp>({
    queryKey: ['miner-detail', uid],
    queryFn: async () => {
      const r = await fetch(`/api/gt/miners/${uid}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 25_000,
    // Keep previous data visible during navigation; the list page hover-prefetches.
    placeholderData: (prev) => prev,
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

  const prsInPeriod    = useMemo(() => prs.filter((p) => withinPeriod(p.prCreatedAt, periodDays)), [prs, periodDays]);
  const discoveredInP  = useMemo(() => discovered.filter((i) => withinPeriod(i.createdAt, periodDays)), [discovered, periodDays]);
  const solvedInPeriod = useMemo(() => solved.filter((i) => withinPeriod(i.closedAt ?? i.createdAt, periodDays)), [solved, periodDays]);

  const prsFiltered = useMemo(
    () => selectedRepo ? prsInPeriod.filter((p) => p.repository.toLowerCase() === selectedRepo.toLowerCase()) : prsInPeriod,
    [prsInPeriod, selectedRepo],
  );
  const discoveredFiltered = useMemo(
    () => selectedRepo ? discoveredInP.filter((i) => i.repo.toLowerCase() === selectedRepo.toLowerCase()) : discoveredInP,
    [discoveredInP, selectedRepo],
  );

  // Repo-filtered so the Activity card responds to the P&L selection.
  const prAgg = useMemo(() => {
    let merged = 0, open = 0, closed = 0;
    let realScoreSum = 0, additions = 0, deletions = 0, predictedUsd = 0;
    const repos = new Set<string>();
    for (const p of prsFiltered) {
      if      (p.prState === 'MERGED') merged += 1;
      else if (p.prState === 'OPEN')   open   += 1;
      else                              closed += 1;
      realScoreSum += p.realScore;
      additions    += p.additions;
      deletions    += p.deletions;
      predictedUsd += p.predictedUsdPerDay;
      repos.add(p.repository);
    }
    return { total: prsFiltered.length, merged, open, closed, realScoreSum, additions, deletions, predictedUsd, uniqueRepos: repos.size };
  }, [prsFiltered]);

  const issueAgg = useMemo(() => {
    let solv = 0, comp = 0, op = 0, cl = 0;
    const repos = new Set<string>();
    for (const i of discoveredFiltered) {
      if      (i.bucket === 'solved')    solv += 1;
      else if (i.bucket === 'completed') comp += 1;
      else if (i.bucket === 'open')      op   += 1;
      else                                cl   += 1;
      repos.add(i.repo);
    }
    const solvedFiltered = selectedRepo
      ? solvedInPeriod.filter((i) => i.repo.toLowerCase() === selectedRepo.toLowerCase())
      : solvedInPeriod;
    return {
      total: discoveredFiltered.length,
      solved: solv, completed: comp, open: op, closed: cl,
      solvedExternal: solvedFiltered.length,
      uniqueRepos: repos.size,
    };
  }, [discoveredFiltered, solvedInPeriod, selectedRepo]);

  // Canonicalise repo casing: prefer mixed-case over all-lowercase across sources.
  const repoBreakdown = useMemo(() => {
    const canonical = new Map<string, string>();
    const reg = (name: string) => {
      const k = name.toLowerCase();
      const existing = canonical.get(k);
      if (!existing || (name !== name.toLowerCase() && existing === existing.toLowerCase())) canonical.set(k, name);
    };
    for (const e of data?.repoEvals ?? []) reg(e.repo);
    for (const p of prsInPeriod) reg(p.repository);
    for (const i of discoveredInP) reg(i.repo);
    for (const i of solvedInPeriod) reg(i.repo);
    const resolve = (r: string) => canonical.get(r.toLowerCase()) ?? r;

    const map = new Map<string, RepoBucket>();
    const get = (r: string): RepoBucket => {
      const c = resolve(r);
      let row = map.get(c);
      if (!row) { row = makeRepoBucket(c); map.set(c, row); }
      return row;
    };
    for (const p of prsInPeriod) {
      const r = get(p.repository);
      r.prs.push(p);
      if (p.prState === 'MERGED') { r.merged += 1; if (p.tokenScore >= 5) r.validPrs += 1; }
      else if (p.prState === 'OPEN') r.openPr += 1;
      else r.closedPr += 1;
      r.realScore   += p.realScore;
      r.additions   += p.additions;
      r.deletions   += p.deletions;
      r.predictedUsd += p.predictedUsdPerDay;
    }
    for (const i of discoveredInP) {
      const r = get(i.repo);
      r.discovered.push(i);
      if      (i.bucket === 'open')      r.openIssue      += 1;
      else if (i.bucket === 'solved')    r.solvedIssue    += 1;
      else if (i.bucket === 'completed') r.completedIssue += 1;
      else                                r.closedIssue    += 1;
    }
    for (const i of solvedInPeriod) get(i.repo).solvedByPr.push(i);
    return Array.from(map.values()).sort((a, b) => {
      const aw = mode === 'oss' ? a.prs.length : a.discovered.length + a.solvedByPr.length;
      const bw = mode === 'oss' ? b.prs.length : b.discovered.length + b.solvedByPr.length;
      if (aw !== bw) return bw - aw;
      return b.realScore - a.realScore;
    });
  }, [prsInPeriod, discoveredInP, solvedInPeriod, mode, data?.repoEvals]);

  const ossEligibleCount  = useMemo(() => repoBreakdown.filter(r => repoEvalMap.get(r.repo.toLowerCase())?.isEligible      === true).length, [repoBreakdown, repoEvalMap]);
  const discEligibleCount = useMemo(() => repoBreakdown.filter(r => repoEvalMap.get(r.repo.toLowerCase())?.isIssueEligible === true).length, [repoBreakdown, repoEvalMap]);

  const ghNameStr = miner?.githubUsername || `uid-${uid}`;
  const ghAvatarUrl = `https://github.com/${ghNameStr}.png?size=160`;
  const ossEligible   = !!miner?.isEligible;
  const issueEligible = !!miner?.isIssueEligible;

  const usdPerDay = num(miner?.usdPerDay);
  const { oss: ossEarningPerDay, disc: discEarningPerDay } = splitEarnings(
    usdPerDay,
    num(miner?.totalScore),
    num(miner?.issueDiscoveryScore),
    ossEligible,
    issueEligible,
  );

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
        <PageLayout.Header><BackLink /></PageLayout.Header>
        <PageLayout.Content>
          <EmptyState text={`Could not load miner UID ${uid}.`} />
        </PageLayout.Content>
      </PageLayout>
    );
  }

  return (
    <PageLayout containerWidth="full" padding="normal">
      <PageLayout.Header>
        <BackLink />

        <ProfileHero
          ghName={ghNameStr}
          ghAvatar={ghAvatarUrl}
          miner={miner}
          uid={uid}
          isMe={isMe}
          isTracked={isTracked}
          toggle={() => miner && toggle(String(miner.uid))}
          copied={copied}
          onCopyHotkey={copyHotkey}
        />

        <PositionSummary
          loading={!miner}
          usdPerDay={usdPerDay}
          ossEarningPerDay={ossEarningPerDay}
          discEarningPerDay={discEarningPerDay}
          ossEligible={ossEligible}
          issueEligible={issueEligible}
          ossEligibleCount={ossEligibleCount}
          discEligibleCount={discEligibleCount}
          totalScore={num(miner?.totalScore)}
          issueScore={num(miner?.issueDiscoveryScore)}
          baseScore={num(miner?.baseTotalScore)}
          lifetimeUsd={num(miner?.lifetimeUsd)}
          lifetimeTao={num(miner?.lifetimeTao)}
          lifetimeAlpha={num(miner?.lifetimeAlpha)}
          cred={num(miner?.credibility)}
          issueCred={num(miner?.issueCredibility)}
        />
      </PageLayout.Header>

      <PageLayout.Content>
        {/* Mode (primary axis) left, period (secondary filter) right. */}
        <Box
          sx={{
            mt: [2, null, 3],
            mb: [2, null, 3],
            display: 'flex',
            flexWrap: 'wrap',
            gap: 2,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Segmented<Mode>
            ariaLabel="Mode"
            options={[
              { key: 'oss',       label: 'OSS',       icon: <GitPullRequestIcon size={10} /> },
              { key: 'discovery', label: 'Discovery', icon: <IssueOpenedIcon   size={10} /> },
            ]}
            value={mode}
            onChange={setMode}
          />
          <Segmented<Period>
            ariaLabel="Period"
            options={PERIODS.map((p) => ({ key: p.key, label: p.label }))}
            value={period}
            onChange={setPeriod}
          />
        </Box>

        <Box sx={{ mb: 3 }}>
          <RepoBreakdown
            key={mode}
            repos={repoBreakdown}
            selectedRepo={selectedRepo}
            onSelectRepo={(r) => setSelectedRepo((prev) => (prev === r ? null : r))}
            mode={mode}
            ossEarningPerDay={ossEarningPerDay}
            discEarningPerDay={discEarningPerDay}
            issueDiscoveryScore={num(miner?.issueDiscoveryScore)}
            repoEvalMap={repoEvalMap}
          />
        </Box>

        <Box
          sx={{
            mb: 3,
            display: 'grid',
            gridTemplateColumns: mode === 'oss'
              ? ['1fr', null, null, '1fr 1fr']
              : '1fr',
            gap: 3,
            alignItems: 'stretch',
          }}
        >
          <ActivitySummary
            mode={mode}
            prAgg={prAgg}
            issueAgg={issueAgg}
            ossEligible={ossEligible}
            issueEligible={issueEligible}
            issueScore={num(miner?.issueDiscoveryScore)}
            miner={miner}
            period={period}
          />
          {mode === 'oss' && (
            <CodeImpactCard prAgg={prAgg} miner={miner} />
          )}
        </Box>

        {mode === 'oss' && (
          <Box sx={{ mb: 3 }}>
            <PrList prs={prsFiltered} loading={!data} selectedRepo={selectedRepo} />
          </Box>
        )}

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
                sub={selectedRepo ?? 'authored by this miner'}
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
 * Search + pagination hook
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

/* =========================================================================
 * Back link
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
            fontSize: 0,
            fontWeight: 600,
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

/* =========================================================================
 * Profile hero — single row: avatar + name + UID + chips + actions
 * ========================================================================= */

function ProfileHero({
  ghName, ghAvatar, miner, uid, isMe, isTracked, toggle, copied, onCopyHotkey,
}: {
  ghName: string;
  ghAvatar: string;
  miner: MinerProfile | undefined;
  uid: string;
  isMe: boolean;
  isTracked: boolean;
  toggle: () => void;
  copied: boolean;
  onCopyHotkey: () => void;
}) {
  return (
    <Box
      sx={{
        mt: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap',
        p: 2,
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
      }}
    >
      <Box
        sx={{
          width: [40, null, 48],
          height: [40, null, 48],
          borderRadius: '50%',
          border: '1px solid',
          borderColor: 'border.default',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ghAvatar} alt={ghName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </Box>

      <Box sx={{ flex: '1 1 220px', minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap' }}>
          <Heading
            sx={{
              fontSize: [2, null, 3],
              letterSpacing: '-0.02em',
              color: 'fg.default',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {ghName}
          </Heading>
          <Text sx={{ ...MONO, fontSize: 0, color: 'fg.muted' }}>UID {miner?.uid ?? uid}</Text>
          {isMe && <Label variant="default" sx={{ fontSize: 0 }}>you</Label>}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mt: '4px', flexWrap: 'wrap' }}>
          <EligibilityBadge eligible={!!miner?.isEligible}      label="OSS" />
          <EligibilityBadge eligible={!!miner?.isIssueEligible} label="DISC" />
          {miner?.hotkey && (
            <Box
              as="button"
              onClick={onCopyHotkey}
              aria-label="Copy hotkey"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                px: '8px',
                py: '3px',
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'border.muted',
                bg: 'canvas.inset',
                color: copied ? 'fg.default' : 'fg.muted',
                fontSize: 0,
                fontFamily: 'mono',
                cursor: 'pointer',
                maxWidth: 220,
                transition: 'border-color 100ms, color 100ms',
                '&:hover': { borderColor: 'border.default', color: 'fg.default' },
              }}
            >
              {copied ? <CheckIcon size={10} /> : <KeyIcon size={10} />}
              <Text sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={miner.hotkey}>
                {copied ? 'Copied' : `${miner.hotkey.slice(0, 8)}…${miner.hotkey.slice(-4)}`}
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
                gap: '4px',
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
                '&:hover': { borderColor: 'border.default', color: 'fg.default' },
              }}
            >
              <MarkGithubIcon size={10} /> GitHub <LinkExternalIcon size={9} />
            </Box>
          )}
        </Box>
      </Box>

      <Box
        as="button"
        onClick={toggle}
        aria-label={isTracked ? 'Untrack miner' : 'Track miner'}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          px: 3,
          py: '6px',
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 2,
          bg: isTracked ? 'canvas.inset' : 'canvas.default',
          color: 'fg.default',
          fontWeight: 600,
          fontSize: 0,
          cursor: 'pointer',
          fontFamily: 'inherit',
          flexShrink: 0,
          transition: 'background-color 100ms, border-color 100ms',
          '&:hover': { bg: 'canvas.inset', borderColor: 'border.muted' },
        }}
      >
        {isTracked ? <StarFillIcon size={12} /> : <StarIcon size={12} />}
        {isTracked ? 'Tracked' : 'Track'}
      </Box>
    </Box>
  );
}

/* =========================================================================
 * Position summary — the trader/analyst P&L card
 * ========================================================================= */

function PositionSummary({
  loading, usdPerDay, ossEarningPerDay, discEarningPerDay,
  ossEligible, issueEligible, ossEligibleCount, discEligibleCount,
  totalScore, issueScore, baseScore,
  lifetimeUsd, lifetimeTao, lifetimeAlpha,
  cred, issueCred,
}: {
  loading: boolean;
  usdPerDay: number;
  ossEarningPerDay: number;
  discEarningPerDay: number;
  ossEligible: boolean;
  issueEligible: boolean;
  ossEligibleCount: number;
  discEligibleCount: number;
  totalScore: number;
  issueScore: number;
  baseScore: number;
  lifetimeUsd: number;
  lifetimeTao: number;
  lifetimeAlpha: number;
  cred: number;
  issueCred: number;
}) {
  const monthly = usdPerDay * 30;
  const combinedScore = totalScore + issueScore;
  const blendedCred =
    combinedScore > 0
      ? (totalScore * cred + issueScore * issueCred) / combinedScore
      : (cred + issueCred) / 2;
  const credPct = Math.round(Math.max(0, Math.min(1, blendedCred)) * 100);

  const lifetimeDisplay = lifetimeUsd > 0
    ? formatUsd(lifetimeUsd, { style: 'compact' })
    : lifetimeTao > 0
      ? `${lifetimeTao.toFixed(2)}τ`
      : '—';
  const lifetimeSub = lifetimeUsd > 0
    ? `${lifetimeTao.toFixed(2)}τ · ${lifetimeAlpha.toFixed(2)}α`
    : 'lifetime earnings';

  return (
    <Box
      sx={{
        mt: 2,
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: ['1fr 1fr', null, '1.4fr 1fr 1fr 1fr 1fr'],
          gridAutoRows: '1fr',
        }}
      >
        <Box
          sx={{
            p: ['12px', null, '16px'],
            borderRight:  ['1px solid', null, '1px solid'],
            borderRightColor: 'border.muted',
            borderBottom: ['1px solid', null, 'none'],
            borderBottomColor: 'border.muted',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            minWidth: 0,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Box sx={{ color: 'success.fg', display: 'inline-flex' }}><ZapIcon size={12} /></Box>
            <Text sx={{ ...LABEL }}>Earnings per day</Text>
          </Box>
          <Text
            sx={{
              ...MONO,
              fontSize: [4, null, 5],
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: '-0.03em',
              color: usdPerDay > 0 ? 'success.fg' : 'fg.muted',
            }}
          >
            {loading ? '—' : formatUsd(usdPerDay, { style: 'compact' })}
          </Text>
          <Text sx={{ fontSize: 0, color: 'fg.muted', whiteSpace: 'nowrap' }}>
            {loading ? '' : usdPerDay > 0 ? `~${formatUsd(monthly, { style: 'compact' })} /mo` : 'not earning'}
          </Text>
          {!loading && usdPerDay > 0 && (
            <Box sx={{ mt: 1 }}>
              <SplitBar a={ossEarningPerDay} b={discEarningPerDay} ariaLabel="OSS vs Discovery earnings" />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: '4px', flexWrap: 'wrap' }}>
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: 999, bg: 'accent.fg' }} />
                  <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>
                    OSS {formatUsd(ossEarningPerDay, { style: 'compact' })}
                  </Text>
                </Box>
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: 999, bg: 'done.fg' }} />
                  <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>
                    DISC {formatUsd(discEarningPerDay, { style: 'compact' })}
                  </Text>
                </Box>
              </Box>
            </Box>
          )}
        </Box>

        <SummaryCell
          label="Lifetime"
          value={loading ? '—' : lifetimeDisplay}
          sub={loading ? '' : lifetimeSub}
          icon={<TrophyIcon size={11} />}
          tone="accent"
        />

        <SummaryCell
          label="Score"
          value={loading ? '—' : combinedScore > 0 ? combinedScore.toFixed(2) : '0'}
          sub={loading ? '' : `Base ${baseScore.toFixed(2)} · OSS ${totalScore.toFixed(2)} · DISC ${issueScore.toFixed(2)}`}
          icon={<TrophyIcon size={11} />}
        />

        <SummaryCell
          label="Credibility"
          value={loading ? '—' : combinedScore > 0 || cred + issueCred > 0 ? `${credPct}%` : '—'}
          sub={loading ? '' : 'acceptance rate'}
          tone={credPct >= 80 ? 'success' : credPct >= 50 ? 'neutral' : 'danger'}
          showBar={!loading && (cred + issueCred) > 0}
          barValue={Math.max(0, Math.min(1, blendedCred))}
        />

        <SummaryCell
          label="Repos"
          value={loading ? '—' : `${ossEligibleCount + discEligibleCount}`}
          sub={loading ? '' : `${ossEligibleCount} OSS · ${discEligibleCount} DISC`}
          icon={<RepoIcon size={11} />}
        />
      </Box>
    </Box>
  );
}

function SummaryCell({
  label, value, sub, icon, tone = 'neutral', showBar, barValue,
}: {
  label: string;
  value: string;
  sub: string;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'danger';
  showBar?: boolean;
  barValue?: number;
}) {
  const toneFg =
    tone === 'success' ? 'success.fg'
    : tone === 'danger'  ? 'danger.fg'
    : tone === 'accent'  ? 'accent.fg'
    : 'fg.default';
  return (
    <Box
      sx={{
        p: ['12px', null, '16px'],
        borderRight: ['none', null, '1px solid'],
        borderRightColor: 'border.muted',
        borderTop: ['1px solid', null, 'none'],
        borderTopColor: 'border.muted',
        '&:nth-of-type(2)': { borderRight: ['1px solid', null, '1px solid'], borderRightColor: 'border.muted', borderTop: ['none', null, 'none'] },
        '&:last-of-type': { borderRight: 'none' },
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        {icon && <Box sx={{ color: 'fg.muted', display: 'inline-flex' }}>{icon}</Box>}
        <Text sx={{ ...LABEL }}>{label}</Text>
      </Box>
      <Text
        sx={{
          ...MONO,
          fontSize: [2, null, 3],
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
          color: toneFg,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </Text>
      {showBar && typeof barValue === 'number' && (
        <Box sx={{ mt: '2px' }}>
          <IntensityBar value={barValue} height={3} tone={tone === 'success' ? 'success' : tone === 'danger' ? 'danger' : 'neutral'} />
        </Box>
      )}
      <Text sx={{ fontSize: '10px', color: 'fg.subtle', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {sub}
      </Text>
    </Box>
  );
}

/* =========================================================================
 * Window summary + Code impact — fresh side-by-side design.
 *
 * Both cards share visual rhythm so they read as a pair when displayed
 * in OSS mode:
 *   Card header (icon · title · sub  ──  inline KPIs on the right)
 *   Hero row    (4 KPI tiles, big mono numbers)
 *   Status strip (icon-prefixed badges, slim, fg.muted)
 * ========================================================================= */

type SummaryTone = 'neutral' | 'success' | 'danger' | 'done' | 'accent';

const SUMMARY_TONE_FG: Record<SummaryTone, string> = {
  neutral: 'var(--fg-default)',
  success: 'var(--success-fg)',
  danger:  'var(--danger-fg)',
  done:    'var(--done-fg)',
  accent:  'var(--accent-fg)',
};

function HeroTile({
  label, value, sub, tone = 'neutral', last = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: SummaryTone;
  last?: boolean;
}) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        px: '12px',
        py: '10px',
        borderRight: last ? 'none' : '1px solid',
        borderRightColor: 'border.muted',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      <Text sx={{ ...LABEL, color: 'fg.muted' }}>{label}</Text>
      <Text
        sx={{
          ...MONO,
          fontSize: [2, null, 3],
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: 1.05,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        style={{ color: SUMMARY_TONE_FG[tone] }}
      >
        {value}
      </Text>
      {sub && (
        <Text sx={{ fontSize: '10px', color: 'fg.subtle', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sub}
        </Text>
      )}
    </Box>
  );
}

function StatusBadge({
  icon, value, label, tone = 'neutral',
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
  tone?: SummaryTone;
}) {
  const empty = value === 0 || value === '0';
  return (
    <Box
      sx={{ display: 'inline-flex', alignItems: 'center', gap: '5px', minWidth: 0 }}
      style={{ color: empty ? 'var(--fg-muted)' : SUMMARY_TONE_FG[tone], opacity: empty ? 0.55 : 1 }}
    >
      <Box sx={{ display: 'inline-flex', flexShrink: 0 }}>{icon}</Box>
      <Text sx={{ ...MONO, fontSize: '11px', fontWeight: empty ? 400 : 700, lineHeight: 1 }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </Text>
      <Text sx={{ fontSize: '10px', color: 'fg.subtle', textTransform: 'lowercase' }}>{label}</Text>
    </Box>
  );
}

/* ────────────────────────── ActivitySummary ────────────────────────── */

function ActivitySummary({
  mode, prAgg, issueAgg, ossEligible, issueEligible, issueScore, miner, period,
}: {
  mode: Mode;
  prAgg: { total: number; merged: number; open: number; closed: number; realScoreSum: number; additions: number; deletions: number; predictedUsd: number; uniqueRepos: number };
  issueAgg: { total: number; solved: number; completed: number; open: number; closed: number; solvedExternal: number; uniqueRepos: number };
  ossEligible: boolean;
  issueEligible: boolean;
  issueScore: number;
  miner: MinerProfile | undefined;
  period: Period;
}) {
  const periodLabel = period === 'ALL' ? 'All-time' : period === '1D' ? 'Last 24h' : period === '7D' ? 'Last 7d' : 'Last 35d';

  if (mode === 'oss') {
    const mergeRate = prAgg.total > 0 ? Math.round((prAgg.merged / prAgg.total) * 100) : 0;
    const earning = prAgg.predictedUsd > 0 ? formatUsd(prAgg.predictedUsd, { style: 'compact' }) : '—';
    const score   = prAgg.realScoreSum > 0 ? prAgg.realScoreSum.toFixed(2) : '—';

    return (
      <Card>
        <CardHeader
          icon={<GitPullRequestIcon size={13} />}
          title="Activity"
          sub={`OSS · ${periodLabel}`}
        />
        <Box sx={{ display: 'flex', alignItems: 'stretch', bg: 'canvas.default', borderBottom: '1px solid', borderColor: 'border.muted' }}>
          <HeroTile
            label="PRs"
            value={prAgg.total.toLocaleString()}
            sub={`${prAgg.uniqueRepos} repo${prAgg.uniqueRepos === 1 ? '' : 's'}`}
          />
          <HeroTile
            label="Merge rate"
            value={prAgg.total > 0 ? `${mergeRate}%` : '—'}
            sub={prAgg.total > 0 ? `${prAgg.merged} of ${prAgg.total}` : '—'}
            tone="done"
          />
          <HeroTile
            label="Score"
            value={score}
            sub={ossEligible ? 'window · live' : 'ineligible'}
          />
          <HeroTile
            label="Earning"
            value={earning}
            sub="predicted / day"
            tone={prAgg.predictedUsd > 0 ? 'success' : 'neutral'}
            last
          />
        </Box>
        <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
          <StatusBadge icon={<RepoIcon size={11} />}              value={prAgg.uniqueRepos} label="repos"  tone="accent" />
          <StatusBadge icon={<GitMergeIcon size={11} />}          value={prAgg.merged}      label="merged" tone="done" />
          <StatusBadge icon={<GitPullRequestIcon size={11} />}    value={prAgg.open}        label="open"   tone="success" />
          <StatusBadge icon={<GitPullRequestClosedIcon size={11} />} value={prAgg.closed}   label="closed" tone="danger" />
        </Box>
      </Card>
    );
  }

  const useTotals = period === 'ALL';
  const totalIssues = useTotals
    ? (miner?.totalSolvedIssues ?? 0) + (miner?.totalOpenIssues ?? 0) + (miner?.totalClosedIssues ?? 0)
    : issueAgg.total;
  const solvedDisplay = useTotals ? (miner?.totalSolvedIssues ?? 0) : issueAgg.solved + issueAgg.completed;
  const openDisplay   = useTotals ? (miner?.totalOpenIssues   ?? 0) : issueAgg.open;
  const closedDisplay = useTotals ? (miner?.totalClosedIssues ?? 0) : issueAgg.closed;
  const solveRate = totalIssues > 0 ? Math.round((solvedDisplay / totalIssues) * 100) : 0;

  return (
    <Card>
      <CardHeader
        icon={<IssueOpenedIcon size={13} />}
        title="Activity"
        sub={`Discovery · ${periodLabel}`}
      />
      <Box sx={{ display: 'flex', alignItems: 'stretch', bg: 'canvas.default', borderBottom: '1px solid', borderColor: 'border.muted' }}>
        <HeroTile
          label="Issues"
          value={totalIssues.toLocaleString()}
          sub={useTotals ? 'lifetime' : `${issueAgg.uniqueRepos} repo${issueAgg.uniqueRepos === 1 ? '' : 's'}`}
        />
        <HeroTile
          label="Solve rate"
          value={totalIssues > 0 ? `${solveRate}%` : '—'}
          sub={totalIssues > 0 ? `${solvedDisplay} of ${totalIssues}` : '—'}
          tone="done"
        />
        <HeroTile
          label="Score"
          value={issueScore > 0 ? issueScore.toFixed(2) : '—'}
          sub={issueScore > 0 ? 'discovery' : issueEligible ? 'no emission' : 'ineligible'}
        />
        <HeroTile
          label="Author solved"
          value={issueAgg.solvedExternal.toLocaleString()}
          sub="by you"
          tone="accent"
          last
        />
      </Box>
      <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
        <StatusBadge icon={<RepoIcon size={11} />}        value={issueAgg.uniqueRepos} label="repos"  tone="accent" />
        <StatusBadge icon={<IssueClosedIcon size={11} />} value={solvedDisplay}        label="solved" tone="done" />
        <StatusBadge icon={<IssueOpenedIcon size={11} />} value={openDisplay}          label="open"   tone="success" />
        <StatusBadge icon={<SkipIcon size={11} />}        value={closedDisplay}        label="closed" tone="danger" />
      </Box>
    </Card>
  );
}

/* ────────────────────────── CodeImpactCard ────────────────────────── */

function CodeImpactCard({
  prAgg,
  miner,
}: {
  prAgg: { additions: number; deletions: number; uniqueRepos: number; total: number };
  miner: MinerProfile | undefined;
}) {
  const totalChanged = prAgg.additions + prAgg.deletions;
  const ratio = totalChanged > 0 ? (prAgg.additions / totalChanged) * 100 : 0;
  const addPct = Math.round(ratio);
  const delPct = 100 - addPct;
  const net = prAgg.additions - prAgg.deletions;
  const lifetimeAdded = miner?.totalAdditions ?? 0;
  const lifetimeDeleted = miner?.totalDeletions ?? 0;
  const lifetimeRepos = miner?.uniqueReposCount ?? 0;

  return (
    <Card>
      <CardHeader
        icon={<ZapIcon size={13} />}
        title="Code impact"
        sub={`${prAgg.uniqueRepos} repo${prAgg.uniqueRepos === 1 ? '' : 's'} · ${prAgg.total} PR${prAgg.total === 1 ? '' : 's'}`}
      />
      <Box sx={{ display: 'flex', alignItems: 'stretch', bg: 'canvas.default', borderBottom: '1px solid', borderColor: 'border.muted' }}>
        <HeroTile
          label="Added"
          value={`+${prAgg.additions.toLocaleString()}`}
          sub={totalChanged > 0 ? `${addPct}% of diff` : 'no changes'}
          tone="success"
        />
        <HeroTile
          label="Removed"
          value={`−${prAgg.deletions.toLocaleString()}`}
          sub={totalChanged > 0 ? `${delPct}% of diff` : '—'}
          tone="danger"
        />
        <HeroTile
          label="Net"
          value={`${net >= 0 ? '+' : '−'}${Math.abs(net).toLocaleString()}`}
          sub={net >= 0 ? 'more added' : 'more removed'}
          tone={net >= 0 ? 'success' : 'danger'}
        />
        <HeroTile
          label="Diff"
          value={
            totalChanged > 0
              ? <DiffSplit addPct={addPct} delPct={delPct} />
              : '—'
          }
          sub={totalChanged > 0 ? `${totalChanged.toLocaleString()} lines` : 'no changes'}
          last
        />
      </Box>
      <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
        <Text sx={{ ...LABEL }}>Lifetime</Text>
        <StatusBadge icon={<DiffAddedIcon size={11} />}   value={lifetimeAdded.toLocaleString()}   label="added"   tone="success" />
        <StatusBadge icon={<DiffRemovedIcon size={11} />} value={lifetimeDeleted.toLocaleString()} label="removed" tone="danger" />
        <StatusBadge icon={<RepoIcon size={11} />}        value={lifetimeRepos}                    label="repos"   tone="accent" />
      </Box>
    </Card>
  );
}

function DiffSplit({ addPct, delPct }: { addPct: number; delPct: number }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: '100%',
        // Matches mono numeric height in adjacent tiles.
        height: '1.6em',
      }}
    >
      <Box sx={{ flex: 1, height: 8, borderRadius: 999, overflow: 'hidden', display: 'flex', bg: 'border.muted', minWidth: 0 }}>
        <Box style={{ width: `${addPct}%`, backgroundColor: 'var(--success-fg)' }} />
        <Box style={{ width: `${delPct}%`, backgroundColor: 'var(--danger-fg)' }} />
      </Box>
      <Box sx={{ display: 'inline-flex', gap: '4px', alignItems: 'baseline', flexShrink: 0 }}>
        <Text sx={{ ...MONO, fontSize: '11px', fontWeight: 700, color: 'success.fg' }}>+{addPct}%</Text>
        <Text sx={{ fontSize: '10px', color: 'fg.subtle' }}>/</Text>
        <Text sx={{ ...MONO, fontSize: '11px', fontWeight: 700, color: 'danger.fg' }}>−{delPct}%</Text>
      </Box>
    </Box>
  );
}

/* =========================================================================
 * Per-repo P&L table — sortable, click-to-filter, with intensity bars
 * ========================================================================= */

interface RepoBucket {
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

function makeRepoBucket(repo: string): RepoBucket {
  return {
    repo,
    prs: [], merged: 0, validPrs: 0, openPr: 0, closedPr: 0,
    realScore: 0, additions: 0, deletions: 0, predictedUsd: 0,
    discovered: [], solvedByPr: [],
    openIssue: 0, solvedIssue: 0, completedIssue: 0, closedIssue: 0,
  };
}

type SortCol = 'repo' | 'merged' | 'valid' | 'open' | 'closed' | 'cred' | 'score' | 'earning' | 'solved';
type SortDir = 'asc' | 'desc';

const REPO_COLS = 'minmax(220px, 2.2fr) 58px 70px 60px 58px 62px minmax(70px, 96px) 68px 84px 62px';

function RepoBreakdown({
  repos, selectedRepo, onSelectRepo, mode,
  ossEarningPerDay, discEarningPerDay, issueDiscoveryScore, repoEvalMap,
}: {
  repos: RepoBucket[];
  selectedRepo: string | null;
  onSelectRepo: (repo: string) => void;
  mode: Mode;
  ossEarningPerDay: number;
  discEarningPerDay: number;
  issueDiscoveryScore: number;
  repoEvalMap: Map<string, RepoEval>;
}) {
  const [sortCol, setSortCol] = useState<SortCol>('earning');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sorted = useMemo(() => {
    const eligOf = (r: RepoBucket) => mode === 'oss'
      ? repoEvalMap.get(r.repo.toLowerCase())?.isEligible === true
      : repoEvalMap.get(r.repo.toLowerCase())?.isIssueEligible === true;
    const valueOf = (r: RepoBucket, col: SortCol): number => {
      if (mode === 'oss') {
        switch (col) {
          case 'merged':  return r.merged;
          case 'valid':   return r.validPrs;
          case 'open':    return r.openPr;
          case 'closed':  return r.closedPr;
          case 'cred':    return (r.merged + r.closedPr) > 0 ? r.merged / (r.merged + r.closedPr) : 0;
          case 'score':   return r.realScore;
          case 'earning': return r.predictedUsd;
          case 'solved':  return r.merged;
          case 'repo':    return 0;
        }
      } else {
        switch (col) {
          case 'solved':  return r.solvedIssue;
          case 'valid':   return repoEvalMap.get(r.repo.toLowerCase())?.totalValidSolvedIssues ?? r.solvedByPr.length;
          case 'open':    return r.openIssue;
          case 'closed':  return r.closedIssue;
          case 'cred':    return (r.solvedIssue + r.closedIssue) > 0 ? r.solvedIssue / (r.solvedIssue + r.closedIssue) : 0;
          case 'score':   return r.solvedIssue;
          case 'earning': return r.solvedIssue;
          case 'merged':  return r.solvedIssue;
          case 'repo':    return 0;
        }
      }
    };
    return [...repos].sort((a, b) => {
      const ae = eligOf(a), be = eligOf(b);
      if (ae !== be) return ae ? -1 : 1;
      if (sortCol === 'repo') {
        const cmp = a.repo.localeCompare(b.repo);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const cmp = valueOf(a, sortCol) - valueOf(b, sortCol);
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [repos, sortCol, sortDir, mode, repoEvalMap]);

  const { search, setSearch, page, setPage, pageCount, filtered, paged } = useSearchPage(
    sorted,
    (r, q) => r.repo.toLowerCase().includes(q),
    15,
  );

  // Only eligible repos share the live earnings pool.
  const ossEarnScale = useMemo(() => {
    const eligibleRaw = repos.reduce((s, r) => s + (repoEvalMap.get(r.repo.toLowerCase())?.isEligible ? r.predictedUsd : 0), 0);
    return eligibleRaw > 0 ? ossEarningPerDay / eligibleRaw : 0;
  }, [repos, ossEarningPerDay, repoEvalMap]);
  const discEarnScale = useMemo(() => {
    const totalSolved = repos.reduce((s, r) => s + (repoEvalMap.get(r.repo.toLowerCase())?.isIssueEligible ? r.solvedIssue : 0), 0);
    return totalSolved > 0 ? discEarningPerDay / totalSolved : 0;
  }, [repos, discEarningPerDay, repoEvalMap]);
  const discScoreScale = useMemo(() => {
    const totalSolved = repos.reduce((s, r) => s + (repoEvalMap.get(r.repo.toLowerCase())?.isIssueEligible ? r.solvedIssue : 0), 0);
    return totalSolved > 0 ? issueDiscoveryScore / totalSolved : 0;
  }, [repos, issueDiscoveryScore, repoEvalMap]);

  const earningOf = useCallback((r: RepoBucket) => {
    const e = repoEvalMap.get(r.repo.toLowerCase());
    if (mode === 'oss')   return e?.isEligible      ? r.predictedUsd * ossEarnScale : 0;
    if (mode === 'discovery') return e?.isIssueEligible ? r.solvedIssue  * discEarnScale : 0;
    return 0;
  }, [mode, ossEarnScale, discEarnScale, repoEvalMap]);

  // Denominator for Earn %: each row is its slice of the total, sums to ~100%.
  const totalEarn = useMemo(() => {
    let s = 0;
    for (const r of repos) s += earningOf(r);
    return s;
  }, [repos, earningOf]);

  const sums = useMemo(() => {
    let merged = 0, open = 0, closed = 0, scoreSum = 0, earnSum = 0;
    let solved = 0, valid = 0;
    for (const r of repos) {
      const e = repoEvalMap.get(r.repo.toLowerCase());
      if (mode === 'oss') {
        merged += r.merged; open += r.openPr; closed += r.closedPr;
        valid += r.validPrs;
        if (e?.isEligible) scoreSum += r.realScore;
        earnSum += e?.isEligible ? r.predictedUsd * ossEarnScale : 0;
      } else {
        solved += r.solvedIssue; open += r.openIssue; closed += r.closedIssue;
        valid += e?.totalValidSolvedIssues ?? r.solvedByPr.length;
        if (e?.isIssueEligible) earnSum += r.solvedIssue * discEarnScale;
      }
    }
    if (mode === 'discovery') scoreSum = issueDiscoveryScore;
    return { merged, solved, valid, open, closed, scoreSum, earnSum };
  }, [repos, repoEvalMap, mode, ossEarnScale, discEarnScale, issueDiscoveryScore]);

  if (repos.length === 0) {
    return <EmptyState icon={<RepoIcon size={20} />} text="No repository activity in this window." />;
  }

  const toggleSort = (col: SortCol) => {
    if (col === sortCol) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('desc'); }
    setPage(0);
  };

  const primaryLabel = mode === 'oss' ? 'Merged' : 'Solved';

  return (
    <Card>
      <CardHeader
        icon={<RepoIcon size={13} />}
        title="Per-repository P&L"
        sub={selectedRepo ? `filtering · ${selectedRepo}` : `${repos.length} repo${repos.length === 1 ? '' : 's'}`}
        right={
          <>
            <Pagination page={page} pageCount={pageCount} total={repos.length} filtered={filtered.length} onPage={setPage} zeroIndexed />
            <SearchBox value={search} onChange={setSearch} placeholder="Filter repos…" />
          </>
        }
      />

      <Box sx={{ overflowX: 'auto' }}>
        <Box sx={{ minWidth: 880 }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: REPO_COLS,
              alignItems: 'center',
              borderBottom: '1px solid',
              borderColor: 'border.muted',
              bg: 'canvas.default',
              px: 2,
              py: '8px',
              columnGap: 1,
            }}
          >
            <RepoHdrCell align="left" active={sortCol === 'repo'} dir={sortDir} onClick={() => toggleSort('repo')}>Repository</RepoHdrCell>
            <RepoHdrCell align="center" title="Eligibility for the current track">Eligible</RepoHdrCell>
            <RepoHdrCell active={sortCol === (mode === 'oss' ? 'merged' : 'solved')} dir={sortDir}
              onClick={() => toggleSort(mode === 'oss' ? 'merged' : 'solved')}>{primaryLabel}</RepoHdrCell>
            <RepoHdrCell
              active={sortCol === 'valid'} dir={sortDir} onClick={() => toggleSort('valid')}
              title={mode === 'oss' ? 'Merged PRs with tokenScore ≥ 5' : 'Solved issues counted toward eligibility'}
            >Valid</RepoHdrCell>
            <RepoHdrCell active={sortCol === 'open'} dir={sortDir} onClick={() => toggleSort('open')}>Open</RepoHdrCell>
            <RepoHdrCell active={sortCol === 'closed'} dir={sortDir} onClick={() => toggleSort('closed')}>Closed</RepoHdrCell>
            <RepoHdrCell active={sortCol === 'cred'} dir={sortDir} onClick={() => toggleSort('cred')}>Cred</RepoHdrCell>
            <RepoHdrCell
              active={sortCol === 'earning'} dir={sortDir} onClick={() => toggleSort('earning')}
              title="Share of total daily earnings (earning ÷ Σ earnings)"
            >Earn %</RepoHdrCell>
            <RepoHdrCell active={sortCol === 'earning'} dir={sortDir} onClick={() => toggleSort('earning')}>$/Day</RepoHdrCell>
            <RepoHdrCell active={sortCol === 'score'} dir={sortDir} onClick={() => toggleSort('score')}>Score</RepoHdrCell>
          </Box>

          {paged.map((r) => (
            <RepoRow
              key={r.repo}
              row={r}
              isSelected={selectedRepo === r.repo}
              onSelect={() => onSelectRepo(r.repo)}
              mode={mode}
              repoEval={repoEvalMap.get(r.repo.toLowerCase())}
              earning={earningOf(r)}
              totalEarn={totalEarn}
              discScoreScale={discScoreScale}
            />
          ))}

          {filtered.length === 0 && (
            <Box sx={{ py: 4, textAlign: 'center', color: 'fg.muted', fontSize: 0 }}>
              No repositories match “{search}”
            </Box>
          )}

          {/* Sum row */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: REPO_COLS,
              alignItems: 'center',
              columnGap: 1,
              borderTop: '2px solid',
              borderColor: 'border.default',
              bg: 'canvas.inset',
              px: 2,
              py: '8px',
            }}
          >
            <Text sx={{ ...LABEL, color: 'fg.muted' }}>{repos.length} repos</Text>
            <span />
            {/* Valid intentionally has no total — sum of per-repo Valid counts
                differs from the miner-level Valid the validator applies. */}
            <SumNum v={mode === 'oss' ? sums.merged : sums.solved} />
            <span />
            <SumNum v={sums.open} />
            <SumNum v={sums.closed} />
            <span />
            <SumNum v={sums.earnSum > 0 ? '100%' : '—'} />
            <SumNum v={sums.earnSum > 0 ? formatUsd(sums.earnSum, { style: 'compact' }) : '—'} tone="success" />
            <SumNum v={sums.scoreSum > 0 ? sums.scoreSum.toFixed(2) : '—'} />
          </Box>
        </Box>
      </Box>
    </Card>
  );
}

function RepoHdrCell({
  children, active = false, dir, onClick, align = 'right', title,
}: {
  children: React.ReactNode;
  active?: boolean;
  dir?: SortDir;
  onClick?: () => void;
  align?: 'left' | 'right' | 'center';
  title?: string;
}) {
  const baseSx = {
    ...LABEL,
    color: active ? 'fg.default' : 'fg.muted',
    textAlign: align,
    px: '4px',
  } as const;
  if (!onClick) {
    return <Text title={title} sx={baseSx}>{children}</Text>;
  }
  return (
    <Box
      as="button"
      onClick={onClick}
      sx={{
        ...baseSx,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
        gap: '3px',
        bg: 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        '&:hover': { color: 'fg.default' },
      }}
    >
      {children}
      {active && (dir === 'desc' ? <TriangleDownIcon size={9} /> : <TriangleUpIcon size={9} />)}
    </Box>
  );
}

function SumNum({ v, tone = 'neutral' }: { v: number | string; tone?: 'neutral' | 'success' | 'danger' | 'done' }) {
  const fg = tone === 'success' ? 'success.fg' : tone === 'danger' ? 'danger.fg' : tone === 'done' ? 'done.fg' : 'fg.default';
  const empty = v === '—' || v === 0;
  return (
    <Text
      sx={{ ...MONO, fontSize: '11px', fontWeight: 700, textAlign: 'right', pr: '4px' }}
      style={{ color: empty ? 'var(--fg-muted)' : `var(--${tone}-fg, var(--fg-default))` }}
    >
      <Box as="span" sx={{ color: fg }}>{typeof v === 'number' ? v.toLocaleString() : v}</Box>
    </Text>
  );
}

function RepoRow({
  row, isSelected, onSelect, mode, repoEval, earning, totalEarn, discScoreScale,
}: {
  row: RepoBucket;
  isSelected: boolean;
  onSelect: () => void;
  mode: Mode;
  repoEval: RepoEval | undefined;
  earning: number;
  totalEarn: number;
  discScoreScale: number;
}) {
  const [owner, name] = row.repo.split('/');
  const isEligible = mode === 'oss' ? repoEval?.isEligible === true : repoEval?.isIssueEligible === true;
  const credPct = mode === 'oss'
    ? ((row.merged + row.closedPr) > 0 ? Math.round((row.merged / (row.merged + row.closedPr)) * 100) : null)
    : ((row.solvedIssue + row.closedIssue) > 0 ? Math.round((row.solvedIssue / (row.solvedIssue + row.closedIssue)) * 100) : null);
  const share = totalEarn > 0 ? earning / totalEarn : 0;
  // Discovery: prefer upstream's authoritative count, fall back to local link data.
  const validCount = mode === 'oss'
    ? row.validPrs
    : (repoEval?.totalValidSolvedIssues ?? row.solvedByPr.length);
  const score = mode === 'oss'
    ? (isEligible && row.realScore > 0 ? row.realScore : 0)
    : (isEligible ? row.solvedIssue * discScoreScale : 0);

  return (
    <Box
      as="button"
      onClick={onSelect}
      sx={{
        width: '100%',
        display: 'grid',
        gridTemplateColumns: REPO_COLS,
        alignItems: 'center',
        columnGap: 1,
        px: 2,
        py: '8px',
        border: 'none',
        borderBottom: '1px solid',
        borderColor: 'border.muted',
        '&:last-of-type': { borderBottom: 'none' },
        color: 'fg.default',
        textAlign: 'left',
        fontFamily: 'inherit',
        cursor: 'pointer',
        bg: isSelected ? 'canvas.inset' : 'transparent',
        boxShadow: isSelected ? 'inset 2px 0 0 var(--accent-fg)' : 'none',
        transition: 'background-color 100ms',
        '&:hover': { bg: 'canvas.default' },
      }}
    >
      {/* stopPropagation: row click toggles repo selection; the link navigates. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, pr: 1 }}>
        <Link
          href={`/repos/${owner}/${name}`}
          prefetch={false}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Open ${row.repo} repository page`}
          title={`Open ${row.repo}`}
          style={{ textDecoration: 'none', display: 'inline-flex', flexShrink: 0 }}
        >
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'border.muted',
              bg: 'canvas.default',
              color: 'fg.muted',
              transition: 'color 100ms, border-color 100ms, background-color 100ms',
              '&:hover': { bg: 'canvas.inset', color: 'fg.default', borderColor: 'border.default' },
            }}
          >
            <LinkExternalIcon size={11} />
          </Box>
        </Link>
        <RepoIcon size={11} />
        <Text
          sx={{
            fontSize: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'block',
            fontWeight: isSelected ? 700 : 600,
            color: 'fg.default',
            flex: 1,
            minWidth: 0,
          }}
          title={row.repo}
        >
          {row.repo}
        </Text>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        <Box
          aria-label={isEligible ? 'Eligible' : 'Not eligible'}
          title={isEligible ? 'Eligible' : 'Not eligible'}
          sx={{ width: 6, height: 6, borderRadius: 999, bg: isEligible ? 'success.fg' : 'transparent', border: isEligible ? 'none' : '1px solid', borderColor: 'border.muted' }}
        />
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0, pr: '4px' }}>
        <CountCell
          icon={mode === 'oss' ? <GitMergeIcon size={11} /> : <IssueClosedIcon size={11} />}
          value={mode === 'oss' ? row.merged : row.solvedIssue}
          tone="done"
          title={mode === 'oss' ? 'Merged PRs' : 'Solved issues'}
        />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0, pr: '4px' }}>
        <CountCell
          icon={<CheckCircleIcon size={11} />}
          value={validCount}
          tone="accent"
          title={mode === 'oss' ? 'Merged PRs with tokenScore ≥ 5' : 'Solved issues counted toward eligibility'}
        />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0, pr: '4px' }}>
        <CountCell
          icon={mode === 'oss' ? <GitPullRequestIcon size={11} /> : <IssueOpenedIcon size={11} />}
          value={mode === 'oss' ? row.openPr : row.openIssue}
          tone="success"
          title={mode === 'oss' ? 'Open PRs' : 'Open issues'}
        />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0, pr: '4px' }}>
        <CountCell
          icon={mode === 'oss' ? <GitPullRequestClosedIcon size={11} /> : <SkipIcon size={11} />}
          value={mode === 'oss' ? row.closedPr : row.closedIssue}
          tone="danger"
          title={mode === 'oss' ? 'Closed (unmerged) PRs' : 'Closed (not-planned) issues'}
        />
      </Box>

      <Box
        sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, px: '4px' }}
        title={credPct != null ? `Credibility · ${credPct}%` : 'Credibility · —'}
      >
        <IntensityBar value={credPct != null ? credPct / 100 : 0} height={4} tone="neutral" />
        <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted', textAlign: 'right', lineHeight: 1 }}>
          {credPct != null ? `${credPct}%` : '—'}
        </Text>
      </Box>

      <NumCell v={share > 0 ? `${Math.round(share * 100)}%` : '—'} />

      <NumCell v={earning > 0 ? formatUsd(earning, { style: 'compact' }) : '—'} tone="success" bold />
      <NumCell v={score > 0 ? score.toFixed(2) : '—'} />
    </Box>
  );
}

function NumCell({
  v, tone = 'neutral', bold = false,
}: {
  v: number | string;
  tone?: 'neutral' | 'success' | 'danger' | 'done';
  bold?: boolean;
}) {
  const fg =
    tone === 'success' ? 'success.fg'
    : tone === 'danger'  ? 'danger.fg'
    : tone === 'done'    ? 'done.fg'
    : 'fg.default';
  const empty = v === '—' || v === 0;
  return (
    <Text
      sx={{
        ...MONO,
        fontSize: '11px',
        fontWeight: bold ? 700 : 600,
        textAlign: 'right',
        pr: '4px',
        color: empty ? 'fg.muted' : fg,
      }}
    >
      {typeof v === 'number' ? v.toLocaleString() : v}
    </Text>
  );
}

/* =========================================================================
 * PR list + modal (kept) — compact rows
 * ========================================================================= */

const DECAY_PARAMS = { graceHours: 12, midpoint: 10, steepness: 0.4, floor: 0.05 };
function decayAt(daysSinceCreated: number): number {
  const graceDays = DECAY_PARAMS.graceHours / 24;
  if (daysSinceCreated <= graceDays) return 1;
  const d = daysSinceCreated - graceDays;
  const raw = 1 / (1 + Math.exp(DECAY_PARAMS.steepness * (d - DECAY_PARAMS.midpoint)));
  return Math.max(DECAY_PARAMS.floor, raw);
}

function PrList({ prs, loading, selectedRepo }: { prs: PrDetail[]; loading: boolean; selectedRepo: string | null }) {
  const [modalPr, setModalPr] = useState<PrDetail | null>(null);
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return prs;
    return prs.filter(
      (pr) =>
        pr.title.toLowerCase().includes(q) ||
        pr.repository.toLowerCase().includes(q) ||
        String(pr.pullRequestNumber).includes(q),
    );
  }, [prs, search]);

  useEffect(() => { setPage(1); }, [search, pageSize, selectedRepo]);

  const pageStart = pageSize === Infinity ? 0 : (page - 1) * pageSize;
  const pageEnd   = pageSize === Infinity ? filtered.length : pageStart + pageSize;
  const shown     = filtered.slice(pageStart, pageEnd);

  if (loading) return <ListLoading label="Loading pull requests…" />;
  if (prs.length === 0) {
    return <EmptyState icon={<GitPullRequestIcon size={20} />} text="No pull requests in this window." />;
  }

  return (
    <>
      <Card>
        <CardHeader
          icon={<GitPullRequestIcon size={13} />}
          title="Pull requests"
          sub={selectedRepo ?? `${prs.length} in window`}
          right={
            <>
              <RowSizeSelector value={pageSize} onChange={setPageSize} total={prs.length} filtered={filtered.length} />
              <SearchBox value={search} onChange={setSearch} placeholder="Search PRs…" />
            </>
          }
        />
        <Box>
          {shown.map((pr) => (
            <PrRow key={`${pr.repository}#${pr.pullRequestNumber}`} pr={pr} onOpen={() => setModalPr(pr)} />
          ))}
          {filtered.length === 0 && (
            <Box sx={{ py: 4, textAlign: 'center', color: 'fg.muted', fontSize: 0 }}>
              No pull requests match “{search}”
            </Box>
          )}
        </Box>
        {filtered.length > 0 && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              px: [2, null, 3],
              py: '8px',
              borderTop: '1px solid',
              borderTopColor: 'border.muted',
              bg: 'canvas.subtle',
            }}
          >
            <PageNav page={page} pageSize={pageSize} filteredCount={filtered.length} onPage={setPage} />
          </Box>
        )}
      </Card>
      {modalPr && <PrModal pr={modalPr} onClose={() => setModalPr(null)} />}
    </>
  );
}

function PrRow({ pr, onOpen }: { pr: PrDetail; onOpen: () => void }) {
  const [owner, name] = pr.repository.split('/');
  const ghHref = `https://github.com/${owner}/${name}/pull/${pr.pullRequestNumber}`;
  const stateColor = pr.prState === 'MERGED' ? 'done.fg' : pr.prState === 'OPEN' ? 'success.fg' : 'danger.fg';
  const stateColorVar = pr.prState === 'MERGED'
    ? 'var(--done-fg)'
    : pr.prState === 'OPEN'
      ? 'var(--success-fg)'
      : 'var(--danger-fg)';
  const StateIcon = pr.prState === 'MERGED' ? GitMergeIcon : pr.prState === 'OPEN' ? GitPullRequestIcon : GitPullRequestClosedIcon;
  const scoreDisplay = pr.realScore > 0 ? pr.realScore.toFixed(2) : pr.collateralScore > 0 ? pr.collateralScore.toFixed(2) : '—';
  const stateLabel = pr.prState === 'MERGED' ? 'Merged' : pr.prState === 'OPEN' ? 'Opened' : 'Closed';
  const timeAgo = pr.prState === 'MERGED' && pr.mergedAt
    ? formatRelativeTime(pr.mergedAt)
    : formatRelativeTime(pr.prCreatedAt);

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: ['auto 1fr auto', null, 'auto minmax(0, 1fr) 88px 60px 64px auto 20px'],
        alignItems: 'center',
        gap: [1, null, 3],
        px: [2, null, 3],
        py: '8px',
        borderBottom: '1px solid',
        borderColor: 'border.muted',
        '&:last-of-type': { borderBottom: 'none' },
        '&:hover': { bg: 'canvas.default' },
      }}
    >
      <Box sx={{ color: stateColor, display: 'inline-flex', mt: '1px' }}>
        <StateIcon size={13} />
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
            fontSize: 0,
            fontWeight: 600,
            border: 'none',
            bg: 'transparent',
            fontFamily: 'inherit',
            cursor: 'pointer',
            p: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            '&:hover': { textDecoration: 'underline' },
          }}
        >
          {pr.title}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mt: '1px', flexWrap: 'wrap' }}>
          <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>
            {pr.repository}#{pr.pullRequestNumber}
          </Text>
          {pr.label && (
            <>
              <Text sx={{ color: 'fg.subtle' }}>·</Text>
              <Label variant="default" sx={{ fontSize: 0 }}>{pr.label}</Label>
            </>
          )}
        </Box>
      </Box>
      <Box sx={{ display: ['none', null, 'flex'], alignItems: 'center', gap: 1, ...MONO, fontSize: '10px', color: 'fg.muted', justifyContent: 'flex-end' }}>
        <Text sx={{ color: 'success.fg' }}>+{pr.additions.toLocaleString()}</Text>
        <Text sx={{ color: 'danger.fg' }}>−{pr.deletions.toLocaleString()}</Text>
      </Box>
      <Text sx={{ ...MONO, fontSize: 0, fontWeight: 700, textAlign: 'right', display: ['none', null, 'block'] }}>
        {scoreDisplay}
      </Text>
      <Text
        sx={{ ...MONO, fontSize: 0, fontWeight: 700, textAlign: 'right', display: ['none', null, 'block'] }}
        style={{ color: pr.predictedUsdPerDay > 0 ? 'var(--success-fg)' : 'var(--fg-muted)' }}
      >
        {pr.predictedUsdPerDay > 0 ? formatUsd(pr.predictedUsdPerDay, { style: 'compact' }) : '—'}
      </Text>
      <Box
        sx={{
          display: ['none', null, 'inline-flex'],
          alignItems: 'baseline',
          gap: '6px',
          fontSize: 0,
          whiteSpace: 'nowrap',
        }}
        style={{ color: stateColorVar }}
      >
        <Text sx={{ fontWeight: 700 }}>{stateLabel}</Text>
        <Text sx={{ ...MONO, fontSize: '10px' }}>{timeAgo}</Text>
      </Box>
      <Box
        as="a"
        href={ghHref}
        target="_blank"
        rel="noreferrer"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        sx={{ color: 'fg.muted', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', '&:hover': { color: 'fg.default' } }}
        aria-label="Open on GitHub"
      >
        <LinkExternalIcon size={11} />
      </Box>
    </Box>
  );
}

function PrModal({ pr, onClose }: { pr: PrDetail; onClose: () => void }) {
  const [owner, name] = pr.repository.split('/');
  const ghHref = `https://github.com/${owner}/${name}/pull/${pr.pullRequestNumber}`;
  const stateColor = pr.prState === 'MERGED' ? 'done.fg' : pr.prState === 'OPEN' ? 'success.fg' : 'danger.fg';
  const StateIcon = pr.prState === 'MERGED' ? GitMergeIcon : pr.prState === 'OPEN' ? GitPullRequestIcon : GitPullRequestClosedIcon;
  const daysSinceCreated = Math.max(0, (Date.now() - Date.parse(pr.prCreatedAt)) / 86_400_000);
  const decayValue = pr.timeDecayMultiplier ?? decayAt(daysSinceCreated);
  const decayPct = Math.round(decayValue * 100);
  const dateLabel = pr.prState === 'MERGED' ? 'Merged' : pr.prState === 'CLOSED' ? 'Closed' : 'Opened';
  const dateValue = pr.prState === 'MERGED' && pr.mergedAt ? formatRelativeTime(pr.mergedAt) : formatRelativeTime(pr.prCreatedAt);

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
      sx={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: ['flex-end', null, 'center'], justifyContent: 'center', p: [0, null, 3] }}
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <Box
        sx={{
          bg: 'canvas.default',
          borderRadius: ['12px 12px 0 0', null, 2],
          border: '1px solid',
          borderColor: 'border.default',
          maxWidth: 560,
          width: '100%',
          maxHeight: ['85vh', null, '90vh'],
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
        style={{ boxShadow: '0 24px 48px -12px rgba(0,0,0,0.55)' }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <Box
          sx={{
            px: 3, pt: 3, pb: 2,
            display: 'flex', alignItems: 'flex-start', gap: 2,
            borderBottom: '1px solid', borderColor: 'border.muted',
            position: 'sticky', top: 0, bg: 'canvas.default', zIndex: 1,
          }}
        >
          <Box sx={{ color: stateColor, display: 'inline-flex', mt: '3px', flexShrink: 0 }}>
            <StateIcon size={16} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Text sx={{ display: 'block', fontSize: 2, fontWeight: 700, color: 'fg.default', lineHeight: 1.3, letterSpacing: '-0.01em' }}>
              {pr.title}
            </Text>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mt: '4px', flexWrap: 'wrap' }}>
              <Text sx={{ ...MONO, fontSize: 0, color: 'fg.muted' }}>{pr.repository}#{pr.pullRequestNumber}</Text>
              {pr.label && (
                <>
                  <Text sx={{ color: 'fg.subtle' }}>·</Text>
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
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28,
              border: '1px solid', borderColor: 'border.default', borderRadius: '50%',
              bg: 'canvas.subtle', color: 'fg.muted',
              cursor: 'pointer', flexShrink: 0,
              '&:hover': { bg: 'canvas.inset', color: 'fg.default' },
            }}
          >
            <XIcon size={12} />
          </Box>
        </Box>

        <Box sx={{ px: 3, py: 2, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', borderBottom: '1px solid', borderColor: 'border.muted' }}>
          <Metric label="Changes" value={
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
              <span style={{ color: 'var(--success-fg)' }}>+{pr.additions.toLocaleString()}</span>
              <span style={{ color: 'var(--fg-subtle)' }}>/</span>
              <span style={{ color: 'var(--danger-fg)' }}>−{pr.deletions.toLocaleString()}</span>
            </span>
          } sub={`${pr.commitCount} commit${pr.commitCount !== 1 ? 's' : ''}`} />
          <Metric label="Score" value={pr.realScore > 0 ? pr.realScore.toFixed(3) : pr.collateralScore > 0 ? pr.collateralScore.toFixed(3) : '—'}
            sub={pr.earnedScore != null ? `${pr.earnedScore.toFixed(3)} earned` : pr.score > 0 ? `${pr.score.toFixed(3)} live` : 'pending'} />
          <Metric label="$/Day" value={pr.predictedUsdPerDay > 0 ? formatUsd(pr.predictedUsdPerDay, { style: 'compact' }) : '—'} sub="predicted" tone="success" />
          <Metric label={dateLabel} value={dateValue} sub={pr.prState === 'MERGED' && pr.mergedAt ? pr.mergedAt.slice(0, 10) : pr.prCreatedAt.slice(0, 10)} />
          <Metric label="Time decay" value={`${decayPct}%`} sub={decayPct >= 80 ? 'fresh' : decayPct >= 40 ? 'aging' : 'stale'} />
          <Metric label="State" value={pr.prState} sub={pr.prState === 'OPEN' ? 'in review' : pr.prState === 'MERGED' ? 'merged' : 'closed'} tone={pr.prState === 'MERGED' ? 'done' : pr.prState === 'OPEN' ? 'success' : 'danger'} />
        </Box>

        <Box sx={{ px: 3, pt: 2, pb: 1 }}>
          <Text sx={{ ...LABEL, mb: 1, display: 'block' }}>Time-decay curve</Text>
          <MiniDecayChart daysSinceCreated={daysSinceCreated} currentDecay={decayValue} />
        </Box>

        <Box sx={{ px: 3, py: 2, display: 'flex', justifyContent: 'center' }}>
          <Box
            as="a"
            href={ghHref}
            target="_blank"
            rel="noreferrer"
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 1,
              px: 3, py: '8px',
              border: '1px solid', borderColor: 'border.default', borderRadius: 2,
              bg: 'canvas.subtle', color: 'fg.default', fontSize: 1, fontWeight: 600, textDecoration: 'none',
              '&:hover': { bg: 'canvas.inset', borderColor: 'border.muted' },
            }}
          >
            <MarkGithubIcon size={14} /> View on GitHub <LinkExternalIcon size={12} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function MiniDecayChart({ daysSinceCreated, currentDecay }: { daysSinceCreated: number; currentDecay: number }) {
  const VW = 480, VH = 88;
  const PL = 28, PR = 12, PT = 8, PB = 22;
  const innerW = VW - PL - PR;
  const innerH = VH - PT - PB;
  const DAYS = 30;
  const GRACE = DECAY_PARAMS.graceHours / 24;
  const xScale = (d: number) => PL + Math.min(d / DAYS, 1) * innerW;
  const yScale = (v: number) => PT + (1 - v) * innerH;
  const N = 120;
  const pts: string[] = [];
  for (let i = 0; i <= N; i++) {
    const d = (i / N) * DAYS;
    pts.push(`${xScale(d).toFixed(1)},${yScale(decayAt(d)).toFixed(1)}`);
  }
  const curvePath = `M ${pts.join(' L ')}`;
  const fillPath = `${curvePath} L ${xScale(DAYS).toFixed(1)},${(PT + innerH).toFixed(1)} L ${PL},${(PT + innerH).toFixed(1)} Z`;
  const nowDays = Math.min(daysSinceCreated, DAYS);
  const nowX = xScale(nowDays);
  const nowY = yScale(Math.max(DECAY_PARAMS.floor, Math.min(1, currentDecay)));
  const xTicks = [0, 7, 14, 21, 30];

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ display: 'block', width: '100%', height: 'auto' }} aria-hidden>
      <rect x={PL} y={PT} width={innerW} height={innerH} fill="var(--bg-muted, #0d1117)" rx={3} />
      <rect x={PL} y={PT} width={xScale(GRACE) - PL} height={innerH} fill="var(--success-fg)" opacity={0.12} />
      {[0, 0.25, 0.5, 0.75, 1.0].map((v) => (
        <line key={v} x1={PL} y1={yScale(v)} x2={PL + innerW} y2={yScale(v)} stroke="var(--border-muted)" strokeWidth={0.5} />
      ))}
      <path d={fillPath} fill="var(--accent-fg)" opacity={0.12} />
      <path d={curvePath} fill="none" stroke="var(--accent-fg)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <line x1={PL} y1={yScale(DECAY_PARAMS.floor)} x2={PL + innerW} y2={yScale(DECAY_PARAMS.floor)}
            stroke="var(--fg-muted)" strokeWidth={0.75} strokeDasharray="3 3" opacity={0.5} />
      {daysSinceCreated < DAYS && (
        <line x1={nowX} y1={PT} x2={nowX} y2={PT + innerH} stroke="var(--fg-default)" strokeWidth={1} strokeDasharray="3 2" opacity={0.5} />
      )}
      <circle cx={nowX} cy={nowY} r={4} fill="var(--accent-fg)" />
      <circle cx={nowX} cy={nowY} r={1.6} fill="white" />
      {xTicks.map((d) => (
        <text key={d} x={xScale(d)} y={VH - 5} fontSize={8} fill="var(--fg-muted)"
              textAnchor={d === 0 ? 'start' : d === 30 ? 'end' : 'middle'} fontFamily="monospace">
          {d}d
        </text>
      ))}
      {[0, 0.5, 1.0].map((v) => (
        <text key={v} x={PL - 4} y={yScale(v) + 3} fontSize={8} fill="var(--fg-muted)" textAnchor="end" fontFamily="monospace">
          {Math.round(v * 100)}%
        </text>
      ))}
    </svg>
  );
}

/* =========================================================================
 * Issue list
 * ========================================================================= */

function IssueList({
  issues, title, sub, kind, icon,
}: {
  issues: IssueDetail[];
  title: string;
  sub?: string;
  kind: 'discovered' | 'solved';
  icon: React.ReactNode;
}) {
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return issues;
    return issues.filter((iss) => iss.title.toLowerCase().includes(q) || iss.repo.toLowerCase().includes(q));
  }, [issues, search]);

  useEffect(() => { setPage(1); }, [search, pageSize, sub]);

  const pageStart = pageSize === Infinity ? 0 : (page - 1) * pageSize;
  const pageEnd   = pageSize === Infinity ? filtered.length : pageStart + pageSize;
  const shown     = filtered.slice(pageStart, pageEnd);

  if (issues.length === 0) return null;

  return (
    <Card>
      <CardHeader
        icon={icon}
        title={title}
        sub={sub}
        right={
          <>
            <RowSizeSelector value={pageSize} onChange={setPageSize} total={issues.length} filtered={filtered.length} />
            <SearchBox value={search} onChange={setSearch} placeholder="Search issues…" />
          </>
        }
      />
      <Box>
        {shown.map((iss) => (
          <IssueRow key={`${kind}-${iss.repo}#${iss.number}`} iss={iss} />
        ))}
        {filtered.length === 0 && (
          <Box sx={{ py: 4, textAlign: 'center', color: 'fg.muted', fontSize: 0 }}>
            No issues match “{search}”
          </Box>
        )}
      </Box>
      {filtered.length > 0 && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            px: [2, null, 3],
            py: '8px',
            borderTop: '1px solid',
            borderTopColor: 'border.muted',
            bg: 'canvas.subtle',
          }}
        >
          <PageNav page={page} pageSize={pageSize} filteredCount={filtered.length} onPage={setPage} />
        </Box>
      )}
    </Card>
  );
}

function IssueRow({ iss }: { iss: IssueDetail }) {
  const stateColor =
    iss.bucket === 'solved' || iss.bucket === 'completed' ? 'done.fg'
    : iss.bucket === 'open' ? 'success.fg'
    : 'danger.fg';
  const StateIcon = iss.bucket === 'open' ? IssueOpenedIcon : iss.bucket === 'closed' ? SkipIcon : IssueClosedIcon;
  const stateLabel = iss.bucket === 'solved' ? 'Solved' : iss.bucket === 'completed' ? 'Completed' : iss.bucket === 'open' ? 'Open' : 'Closed';

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: ['auto 1fr auto', null, 'auto minmax(0, 1fr) auto auto auto'],
        alignItems: 'center',
        gap: [1, null, 2],
        px: [2, null, 3],
        py: '8px',
        borderBottom: '1px solid',
        borderColor: 'border.muted',
        '&:last-of-type': { borderBottom: 'none' },
        '&:hover': { bg: 'canvas.default' },
      }}
    >
      <Box sx={{ color: stateColor, display: 'inline-flex', mt: '1px' }}>
        <StateIcon size={13} />
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
            fontSize: 0,
            fontWeight: 600,
            textDecoration: 'none',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            '&:hover': { textDecoration: 'underline' },
          }}
          title={iss.title}
        >
          {iss.title}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mt: '1px', flexWrap: 'wrap' }}>
          <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>{iss.repo}#{iss.number}</Text>
          {iss.comments > 0 && (
            <>
              <Text sx={{ color: 'fg.subtle' }}>·</Text>
              <Text sx={{ fontSize: '10px', color: 'fg.muted', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                <CommentDiscussionIcon size={10} />{iss.comments}
              </Text>
            </>
          )}
        </Box>
      </Box>
      <Text sx={{ display: ['none', null, 'block'], fontSize: 0, fontWeight: 700 }} style={{ color: `var(--${stateColor.includes('done') ? 'done' : stateColor.includes('success') ? 'success' : 'danger'}-fg)` }}>
        {stateLabel}
      </Text>
      <Text sx={{ ...MONO, display: ['none', null, 'block'], fontSize: '10px' }} style={{ color: `var(--${stateColor.includes('done') ? 'done' : stateColor.includes('success') ? 'success' : 'danger'}-fg)` }}>
        {iss.bucket !== 'open' && iss.closedAt ? formatRelativeTime(iss.closedAt) : formatRelativeTime(iss.createdAt)}
      </Text>
      <Box
        as="a"
        href={iss.htmlUrl ?? `https://github.com/${iss.repo}/issues/${iss.number}`}
        target="_blank"
        rel="noreferrer"
        sx={{ color: 'fg.muted', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', '&:hover': { color: 'fg.default' } }}
        aria-label="Open on GitHub"
      >
        <LinkExternalIcon size={11} />
      </Box>
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
