'use client';

export const dynamic = 'force-dynamic';

import React, { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PageLayout, Box } from '@primer/react';
import {
  ArrowLeftIcon, GitPullRequestIcon, IssueOpenedIcon,
} from '@primer/octicons-react';
import { useTrackedMiners } from '@/lib/tracked-miners';
import { useMinerLogin } from '@/lib/use-miner';
import {
  num, splitEarnings,
  Segmented, EmptyState,
} from '../components';
import {
  ListLoading,
  ProfileHero,
  PositionSummary,
  RepoBreakdown,
  PrList,
  IssueList,
  // types
  DetailResp,
  Mode,
  Period,
  PERIODS,
  RepoBucket,
  RepoEval,
  makeRepoBucket,
  withinPeriod,
} from './components';

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

  // Fixed 35d window so the hero reflects recent health regardless of the period selector.
  const HERO_DAYS = 35;
  const heroAgg = useMemo(() => {
    let merged = 0, closedPr = 0, openPr = 0, additions = 0, deletions = 0;
    for (const p of prs) {
      if (!withinPeriod(p.prCreatedAt, HERO_DAYS)) continue;
      if      (p.prState === 'MERGED') merged += 1;
      else if (p.prState === 'CLOSED') closedPr += 1;
      else                              openPr   += 1;
      additions += p.additions;
      deletions += p.deletions;
    }
    let solvedBucket = 0, completedBucket = 0, closedIss = 0, openIss = 0;
    for (const i of discovered) {
      if (!withinPeriod(i.createdAt, HERO_DAYS)) continue;
      if      (i.bucket === 'solved')    solvedBucket    += 1;
      else if (i.bucket === 'completed') completedBucket += 1;
      else if (i.bucket === 'open')      openIss         += 1;
      else                                closedIss       += 1;
    }
    // SOLVED for display = "GitHub-completed" (solved + completed). Matches
    // what the user sees in the P&L table's SOLVED column.
    const solvedDisplay = solvedBucket + completedBucket;
    const totalPrs    = merged + closedPr + openPr;
    const totalIssues = solvedDisplay + closedIss + openIss;
    const ossDenom    = merged + closedPr;
    const discDenom   = solvedDisplay + closedIss;
    const ossCred  = ossDenom  > 0 ? merged        / ossDenom  : 0;
    const discCred = discDenom > 0 ? solvedDisplay / discDenom : 0;
    return {
      merged, closedPr, additions, deletions,
      solved: solvedDisplay, closedIss, openIss,
      totalPrs, totalIssues,
      ossCred, discCred,
    };
  }, [prs, discovered]);

  const prsFiltered = useMemo(
    () => selectedRepo ? prsInPeriod.filter((p) => p.repository.toLowerCase() === selectedRepo.toLowerCase()) : prsInPeriod,
    [prsInPeriod, selectedRepo],
  );
  const discoveredFiltered = useMemo(
    () => selectedRepo ? discoveredInP.filter((i) => i.repo.toLowerCase() === selectedRepo.toLowerCase()) : discoveredInP,
    [discoveredInP, selectedRepo],
  );


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
    // Filter by mode so the table only shows repos relevant to the current
    // track. Without this filter, a repo with PR activity but no issues
    // appears in Discovery mode as "0 / 0 / 0 / 0" — confusing because the
    // sparkline shows activity but no counts (the activity is PR activity
    // that doesn't belong on the Discovery view).
    const all = Array.from(map.values());
    const filtered = mode === 'oss'
      ? all.filter((r) => r.prs.length > 0)
      : all.filter((r) => r.discovered.length > 0 || r.solvedByPr.length > 0);
    return filtered.sort((a, b) => {
      const aw = mode === 'oss' ? a.prs.length : a.discovered.length + a.solvedByPr.length;
      const bw = mode === 'oss' ? b.prs.length : b.discovered.length + b.solvedByPr.length;
      if (aw !== bw) return bw - aw;
      return b.realScore - a.realScore;
    });
  }, [prsInPeriod, discoveredInP, solvedInPeriod, mode, data?.repoEvals]);

  const ossEligibleCount  = useMemo(() => repoBreakdown.filter(r => repoEvalMap.get(r.repo.toLowerCase())?.isEligible      === true).length, [repoBreakdown, repoEvalMap]);
  const discEligibleCount = useMemo(() => repoBreakdown.filter(r => repoEvalMap.get(r.repo.toLowerCase())?.isIssueEligible === true).length, [repoBreakdown, repoEvalMap]);
  const uniqueEligibleCount = useMemo(
    () => repoBreakdown.filter(r => {
      const e = repoEvalMap.get(r.repo.toLowerCase());
      return e?.isEligible === true || e?.isIssueEligible === true;
    }).length,
    [repoBreakdown, repoEvalMap],
  );

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

  // Per-issue earning scales — same math RepoBreakdown uses internally, but
  // lifted here so IssueList can show $/d per row without duplicating the calc.
  const issueDiscoveryScore = num(miner?.issueDiscoveryScore);
  const totalSolvedEligible = useMemo(
    () => repoBreakdown.reduce(
      (s, r) => s + (repoEvalMap.get(r.repo.toLowerCase())?.isIssueEligible ? r.solvedIssue : 0),
      0,
    ),
    [repoBreakdown, repoEvalMap],
  );
  const discEarnScale  = totalSolvedEligible > 0 ? discEarningPerDay  / totalSolvedEligible : 0;
  const discScoreScale = totalSolvedEligible > 0 ? issueDiscoveryScore / totalSolvedEligible : 0;

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
            prs={prs}
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
            uniqueEligibleCount={uniqueEligibleCount}
            totalScore={num(miner?.totalScore)}
            issueScore={num(miner?.issueDiscoveryScore)}
            baseScore={num(miner?.baseTotalScore)}
            lifetimeUsd={num(miner?.lifetimeUsd)}
            lifetimeTao={num(miner?.lifetimeTao)}
            lifetimeAlpha={num(miner?.lifetimeAlpha)}
                    cred={heroAgg.ossCred}
            issueCred={heroAgg.discCred}
            totalMergedPrs={heroAgg.merged}
            totalPrs={heroAgg.totalPrs}
            totalAdditions={heroAgg.additions}
            totalDeletions={heroAgg.deletions}
            totalSolvedIssues={heroAgg.solved}
            totalClosedIssues={heroAgg.closedIss}
            totalOpenIssues={heroAgg.openIss}
            heroWindowDays={HERO_DAYS}
          />
        </Box>
      </PageLayout.Header>

      <PageLayout.Content>
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
            onSelectRepo={(r) => {
              if (r === null) { setSelectedRepo(null); return; }
              setSelectedRepo((prev) => (prev === r ? null : r));
            }}
            mode={mode}
            ossEarningPerDay={ossEarningPerDay}
            discEarningPerDay={discEarningPerDay}
            issueDiscoveryScore={num(miner?.issueDiscoveryScore)}
            repoEvalMap={repoEvalMap}
            periodDays={periodDays}
            periodLabel={PERIODS.find((p) => p.key === period)?.label ?? period}
          />
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
                discScoreScale={discScoreScale}
                discEarnScale={discEarnScale}
                repoEvalMap={repoEvalMap}
              />
            )}
          </Box>
        )}
      </PageLayout.Content>
    </PageLayout>
  );
}
