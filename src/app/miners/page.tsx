'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageLayout, Text, Box } from '@primer/react';
import { useMinerLogin } from '@/lib/use-miner';
import { useTrackedMiners } from '@/lib/tracked-miners';
import { Miner, ghName, num } from './components';
import { Insights } from './Insights';
import {
  LeaderTable,
  Toolbar,
  EligibilityFilter,
  SortKey,
  SortDir,
} from './LeaderTable';

interface MinersResp {
  count: number;
  fetched_at: number;
  source?: string;
  miners: Miner[];
}

const DEFAULT_ROWS = 25;

export default function MinersPage() {
  const me = useMinerLogin();
  const { tracked, toggle } = useTrackedMiners();
  const [query, setQuery] = useState('');
  const [eligibility, setEligibility] = useState<EligibilityFilter>('all');
  const [tracksOnly, setTracksOnly] = useState(false);
  const [repoFilter, setRepoFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [pageSize, setPageSize] = useState<number>(DEFAULT_ROWS);
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery<MinersResp>({
    queryKey: ['miners'],
    queryFn: async () => {
      const r = await fetch('/api/miners');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  const queryClient = useQueryClient();
  const prefetchMiner = useCallback((uid: number | string) => {
    queryClient.prefetchQuery({
      queryKey: ['miner-detail', String(uid)],
      queryFn: async () => {
        const r = await fetch(`/api/gt/miners/${uid}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      },
      staleTime: 25_000,
    });
  }, [queryClient]);

  // Full-dataset ranks so movement and #N labels stay stable while filtering/paging.
  const ranksByUid = useMemo(() => {
    const map = new Map<number, number>();
    if (!data?.miners) return map;
    const sorted = [...data.miners].sort(
      (a, b) => num(b.totalScore) + num(b.issueDiscoveryScore) - (num(a.totalScore) + num(a.issueDiscoveryScore)),
    );
    sorted.forEach((m, i) => map.set(m.uid, i + 1));
    return map;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data?.miners) return [];
    const q = query.trim().toLowerCase();
    const repoLc = repoFilter?.toLowerCase() ?? null;
    return data.miners.filter((m) => {
      if (q && !`${ghName(m)} ${m.uid} ${m.hotkey ?? ''}`.toLowerCase().includes(q)) return false;
      const eligible = !!m.isEligible || !!m.isIssueEligible;
      if (eligibility === 'eligible' && !eligible) return false;
      if (eligibility === 'ineligible' && eligible) return false;
      if (tracksOnly && !tracked.has(String(m.uid))) return false;
      if (repoLc) {
        const hit = (m.topRepos ?? []).some((r) => r.name.toLowerCase() === repoLc);
        if (!hit) return false;
      }
      return true;
    });
  }, [data, query, eligibility, tracksOnly, tracked, repoFilter]);

  // Eligible miners always float to top regardless of sort key.
  const sorted = useMemo(() => {
    const combinedScore = (m: Miner) => num(m.totalScore) + num(m.issueDiscoveryScore);
    const combinedCred = (m: Miner) => {
      const merged = m.totalMergedPrs ?? 0;
      const solved = m.totalSolvedIssues ?? 0;
      const closed = (m.totalClosedPrs ?? 0) + (m.totalClosedIssues ?? 0);
      const denom = merged + solved + closed;
      return denom > 0 ? (merged + solved) / denom : 0;
    };
    const valueOf = (m: Miner): number => {
      switch (sortKey) {
        case 'score':    return combinedScore(m);
        case 'cred':     return combinedCred(m);
        case 'usd':      return num(m.usdPerDay);
        case 'repos':    return Math.max(m.eligibleRepoCount ?? 0, m.issueEligibleRepoCount ?? 0);
        case 'active': {
          const iso = (m.lastOssActivityAt && m.lastDiscoveryActivityAt)
            ? (m.lastOssActivityAt > m.lastDiscoveryActivityAt ? m.lastOssActivityAt : m.lastDiscoveryActivityAt)
            : (m.lastOssActivityAt ?? m.lastDiscoveryActivityAt);
          return iso ? Date.parse(iso) : 0;
        }
        case 'movement': {
          const prev = m.previousRank ?? null;
          const now = ranksByUid.get(m.uid) ?? 0;
          // Bigger climbs sort first when desc; null movement sinks.
          return prev != null && now > 0 ? prev - now : Number.NEGATIVE_INFINITY;
        }
        case 'volume': {
          const merged = m.totalValidMergedPrs ?? m.totalMergedPrs ?? 0;
          const solved = m.totalSolvedIssues ?? 0;
          return merged + solved;
        }
      }
    };
    const eligibleOf = (m: Miner) => !!m.isEligible || !!m.isIssueEligible;
    return [...filtered].sort((a, b) => {
      const aE = eligibleOf(a), bE = eligibleOf(b);
      if (aE !== bE) return aE ? -1 : 1;
      const cmp = valueOf(a) - valueOf(b);
      const eff = cmp === 0 ? combinedScore(a) - combinedScore(b) : cmp;
      return sortDir === 'desc' ? -eff : eff;
    });
  }, [filtered, sortKey, sortDir, ranksByUid]);

  useEffect(() => { setPage(1); }, [query, eligibility, tracksOnly, sortKey, sortDir, pageSize, repoFilter]);

  const pageStart = pageSize === Infinity ? 0 : (page - 1) * pageSize;
  const pageEnd   = pageSize === Infinity ? sorted.length : pageStart + pageSize;
  const visible   = sorted.slice(pageStart, pageEnd);

  const onSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('desc'); }
  };
  const onSortKey = (k: SortKey) => { setSortKey(k); setSortDir('desc'); };
  const onToggleSortDir = () => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));

  const loadingFirst = isLoading && !data;

  return (
    <PageLayout containerWidth="full" padding="normal">
      <PageLayout.Header>
        <Insights miners={data?.miners ?? []} loading={loadingFirst} />
      </PageLayout.Header>

      <PageLayout.Content>
        <Toolbar
          query={query}
          setQuery={setQuery}
          eligibility={eligibility}
          setEligibility={setEligibility}
          tracksOnly={tracksOnly}
          setTracksOnly={setTracksOnly}
          trackedCount={tracked.size}
          repoFilter={repoFilter}
          onClearRepoFilter={() => setRepoFilter(null)}
          pageSize={pageSize}
          onPageSize={setPageSize}
          totalItems={sorted.length}
          totalAll={data?.miners.length ?? 0}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortKey={onSortKey}
          onToggleSortDir={onToggleSortDir}
        />

        {isError ? (
          <Box
            sx={{
              p: 3,
              border: '1px solid',
              borderColor: 'danger.emphasis',
              borderRadius: 2,
              bg: 'canvas.subtle',
              mt: 2,
            }}
          >
            <Text sx={{ color: 'danger.fg' }}>Failed to load miners.</Text>
          </Box>
        ) : (
          <LeaderTable
            miners={visible}
            ranksByUid={ranksByUid}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            me={me}
            tracked={tracked}
            onToggleTrack={toggle}
            loading={loadingFirst}
            onPrefetch={prefetchMiner}
            page={page}
            pageSize={pageSize}
            onPage={setPage}
            filteredCount={sorted.length}
            repoFilter={repoFilter}
            onPickRepo={setRepoFilter}
          />
        )}
      </PageLayout.Content>
    </PageLayout>
  );
}
