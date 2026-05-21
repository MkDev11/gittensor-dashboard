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
  ActivitySummary,
  CodeImpactCard,
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

  // Repo-filtered so the Activity card responds to the repo selection.
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
