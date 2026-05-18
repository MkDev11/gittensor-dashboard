'use client';

export const dynamic = 'force-dynamic';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageLayout, Heading, Text, Box, TextInput, Label } from '@primer/react';
import {
  SearchIcon,
  StarIcon,
  StarFillIcon,
  TableIcon,
  ListUnorderedIcon,
  TriangleDownIcon,
  TriangleUpIcon,
} from '@primer/octicons-react';
import { TableRowsSkeleton, CardGridSkeleton } from '@/components/Skeleton';
import { useMinerLogin } from '@/lib/use-miner';
import { useTrackedMiners } from '@/lib/tracked-miners';

interface Miner {
  id: string;
  uid: number;
  hotkey: string;
  githubUsername: string;
  githubId?: string;
  isEligible: boolean;
  isIssueEligible?: boolean;
  failedReason?: string | null;
  credibility: string;
  issueCredibility?: string;
  issueDiscoveryScore?: string;
  issueTokenScore?: string;
  totalScore: string;
  baseTotalScore?: string;
  totalSolvedIssues?: number;
  totalValidSolvedIssues?: number;
  totalOpenIssues?: number;
  totalClosedIssues?: number;
  totalOpenPrs?: number;
  totalClosedPrs?: number;
  totalMergedPrs?: number;
  totalPrs?: number;
  totalAdditions?: number;
  totalDeletions?: number;
  uniqueReposCount?: number;
  alphaPerDay?: number;
  taoPerDay?: number;
  usdPerDay?: number;
}

interface MinersResp {
  count: number;
  fetched_at: number;
  source?: string;
  miners: Miner[];
}

type SortKey = 'score' | 'earnings' | 'issues' | 'credibility';
type EligibilityFilter = 'all' | 'eligible' | 'ineligible';
type ViewMode = 'grid' | 'list';

const SORT_LABEL: Record<SortKey, string> = {
  score: 'Score',
  earnings: 'Earnings',
  issues: 'Issues',
  credibility: 'Credibility',
};

const SORT_KEYS: SortKey[] = ['score', 'earnings', 'issues', 'credibility'];

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

function fmtUsd(n: number): string {
  if (!n) return '$0';
  if (n >= 1000) return `$${n.toFixed(0)}`;
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function fmtMonthly(daily: number): string {
  return `~$${(daily * 30).toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo`;
}

function fmtPct(credStr: string): string {
  return `${Math.round(num(credStr) * 100)}%`;
}

export default function MinersPage() {
  const me = useMinerLogin();
  const { tracked, toggle } = useTrackedMiners();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [eligibility, setEligibility] = useState<EligibilityFilter>('all');
  const [view, setView] = useState<ViewMode>('grid');
  const [leaderboardMode, setLeaderboardMode] = useState<'usd' | 'issues'>('usd');

  const onSortChange = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
  };

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

  // Stable rank — gittensor.io discoveries ranks by issueDiscoveryScore
  // (the issue-context score), not the global totalScore.
  const rankByScore = useMemo(() => {
    const map = new Map<string, number>();
    if (!data?.miners) return map;
    const sorted = [...data.miners].sort((a, b) => num(b.issueDiscoveryScore) - num(a.issueDiscoveryScore));
    sorted.forEach((m, i) => map.set(m.id, i + 1));
    return map;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data?.miners) return [] as Miner[];
    const q = query.trim().toLowerCase();
    let list = data.miners.filter((m) => {
      if (q && !`${m.githubUsername} ${m.uid} ${m.hotkey ?? ''}`.toLowerCase().includes(q)) return false;
      if (eligibility === 'eligible' && !m.isIssueEligible) return false;
      if (eligibility === 'ineligible' && m.isIssueEligible) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      // Match gittensor.io: ELIGIBLE miners always come before INELIGIBLE ones,
      // regardless of which sort metric is active. The selected metric only
      // orders within each eligibility group.
      if (a.isIssueEligible !== b.isIssueEligible) {
        return a.isIssueEligible ? -1 : 1;
      }
      let cmp = 0;
      // All ranks use the issue-context fields — this page mirrors
      // gittensor.io's /discoveries which is purely about issue rewards.
      if (sortKey === 'score') cmp = num(a.issueDiscoveryScore) - num(b.issueDiscoveryScore);
      else if (sortKey === 'earnings') cmp = num(a.usdPerDay) - num(b.usdPerDay);
      else if (sortKey === 'issues') cmp = (a.totalOpenIssues ?? 0) - (b.totalOpenIssues ?? 0);
      else if (sortKey === 'credibility') cmp = num(a.issueCredibility) - num(b.issueCredibility);
      // Tie-breaker: discovery score (so credibility ties don't shuffle randomly)
      if (cmp === 0) cmp = num(a.issueDiscoveryScore) - num(b.issueDiscoveryScore);
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return list;
  }, [data, query, eligibility, sortKey, sortDir]);

  // Aggregate sidebar stats — all values recomputed against the same scope as
  // the visible miners list (`filtered`), so toggling All / Eligible /
  // Ineligible reshapes every card.
  const stats = useMemo(() => {
    const empty = {
      counts: { all: 0, eligible: 0, ineligible: 0 },
      issueCounts: { all: 0, eligible: 0, ineligible: 0 },
      pr: { merged: 0, open: 0, closed: 0, mergeRate: 0, totalDay: 0 },
      issue: { solved: 0, open: 0, closed: 0, solveRate: 0, totalDay: 0 },
      code: { added: 0, deleted: 0, repos: 0, avgCred: 0 },
      topEarners: [] as Miner[],
      mostActive: [] as Miner[],
    };
    if (!data?.miners) return empty;
    const scope = filtered;

    let merged = 0, openPr = 0, closedPr = 0, prDay = 0;
    let solved = 0, openIs = 0, closedIs = 0, isDay = 0;
    let added = 0, deleted = 0, repos = 0, credSum = 0, credN = 0;
    let prAll = 0, prElig = 0, prInelig = 0;
    let isAll = 0, isElig = 0, isInelig = 0;
    for (const m of scope) {
      merged += m.totalMergedPrs ?? 0;
      openPr += m.totalOpenPrs ?? 0;
      closedPr += m.totalClosedPrs ?? 0;
      solved += m.totalSolvedIssues ?? 0;
      openIs += m.totalOpenIssues ?? 0;
      closedIs += m.totalClosedIssues ?? 0;
      added += m.totalAdditions ?? 0;
      deleted += m.totalDeletions ?? 0;
      repos += m.uniqueReposCount ?? 0;
      const c = num(m.issueCredibility ?? m.credibility);
      if (c > 0) { credSum += c; credN += 1; }
      // Total $/day per track is sum of usdPerDay for miners eligible in that
      // track (matches gittensor.io). A miner can be eligible for both, in
      // which case their full usdPerDay counts toward each track's total.
      const usd = m.usdPerDay ?? 0;
      if (m.isEligible) prDay += usd;
      if (m.isIssueEligible) isDay += usd;
      // Miners Activity: PR column tracks isEligible, ISSUE column tracks isIssueEligible.
      prAll += 1;
      if (m.isEligible) prElig += 1; else prInelig += 1;
      isAll += 1;
      if (m.isIssueEligible) isElig += 1; else isInelig += 1;
    }
    const totalPr = merged + closedPr;
    const totalIs = solved + closedIs;

    const topEarners = [...scope]
      .sort((a, b) => num(b.usdPerDay) - num(a.usdPerDay))
      .slice(0, 5);
    const mostActive = [...scope]
      .sort((a, b) => (b.totalOpenIssues ?? 0) - (a.totalOpenIssues ?? 0))
      .slice(0, 5);

    return {
      counts: { all: prAll, eligible: prElig, ineligible: prInelig },
      issueCounts: { all: isAll, eligible: isElig, ineligible: isInelig },
      pr: { merged, open: openPr, closed: closedPr, mergeRate: totalPr ? Math.round((merged / totalPr) * 100) : 0, totalDay: prDay },
      issue: { solved, open: openIs, closed: closedIs, solveRate: totalIs ? Math.round((solved / totalIs) * 100) : 0, totalDay: isDay },
      code: { added, deleted, repos, avgCred: credN ? credSum / credN : 0 },
      topEarners,
      mostActive,
    };
  }, [data, filtered]);

  return (
    <PageLayout containerWidth="full" padding="normal">
      <PageLayout.Header>
        <Heading sx={{ fontSize: 4, mb: 1 }}>Miners</Heading>
        <Text sx={{ color: 'fg.muted' }}>
          SN74 miners — earnings, scoring, eligibility. Discovery rewards filed via quality issues are scored separately
          from PR rewards.
        </Text>
      </PageLayout.Header>
      <PageLayout.Content>
        <Box sx={{ display: ['block', null, 'flex'], gap: 4, alignItems: 'flex-start' }}>
          {/* main column */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {/* Toolbar */}
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'border.default',
                borderRadius: 2,
                bg: 'canvas.subtle',
                p: 3,
                mb: 3,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', mb: 2 }}>
                <Heading sx={{ fontSize: 3, fontWeight: 700 }}>
                  Miners <Text sx={{ color: 'fg.muted', fontWeight: 400 }}>({data?.count ?? 0})</Text>
                </Heading>
                <Box sx={{ flex: 1, minWidth: 240 }}>
                  <TextInput
                    leadingVisual={SearchIcon}
                    placeholder="Search miners…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    sx={{ width: '100%' }}
                  />
                </Box>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                  {SORT_KEYS.map((k) => {
                    const active = sortKey === k;
                    return (
                      <Box
                        as="button"
                        key={k}
                        onClick={() => onSortChange(k)}
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 1,
                          px: 2,
                          py: '4px',
                          border: '1px solid',
                          borderColor: active ? 'var(--border-default)' : 'transparent',
                          borderRadius: 1,
                          bg: active ? 'var(--bg-emphasis)' : 'transparent',
                          color: active ? 'var(--fg-default)' : 'var(--fg-muted)',
                          fontSize: 1,
                          fontWeight: active ? 600 : 500,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          '&:hover': { color: 'var(--fg-default)' },
                        }}
                      >
                        {SORT_LABEL[k]}
                        {active && (sortDir === 'desc' ? <TriangleDownIcon size={12} /> : <TriangleUpIcon size={12} />)}
                      </Box>
                    );
                  })}
                </Box>

                <Box sx={{ ml: 'auto', display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                  {(['all', 'eligible', 'ineligible'] as EligibilityFilter[]).map((e) => (
                    <Box
                      as="button"
                      key={e}
                      onClick={() => setEligibility(e)}
                      sx={{
                        px: 2,
                        py: '4px',
                        border: '1px solid',
                        borderColor: eligibility === e ? 'var(--border-default)' : 'transparent',
                        borderRadius: 1,
                        bg: eligibility === e ? 'var(--bg-emphasis)' : 'transparent',
                        color: eligibility === e ? 'var(--fg-default)' : 'var(--fg-muted)',
                        fontSize: 1,
                        fontWeight: 500,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        textTransform: 'capitalize',
                        '&:hover': { color: 'var(--fg-default)' },
                      }}
                    >
                      {e}
                    </Box>
                  ))}
                  <Box sx={{ width: '1px', height: 20, bg: 'border.default', mx: 1 }} />
                  <ViewToggleBtn active={view === 'grid'} onClick={() => setView('grid')} aria="Grid view">
                    <TableIcon size={14} />
                  </ViewToggleBtn>
                  <ViewToggleBtn active={view === 'list'} onClick={() => setView('list')} aria="List view">
                    <ListUnorderedIcon size={14} />
                  </ViewToggleBtn>
                </Box>
              </Box>
            </Box>

            {isError && (
              <Box sx={{ p: 3, border: '1px solid', borderColor: 'danger.emphasis', bg: 'danger.subtle', borderRadius: 2, mb: 2 }}>
                <Text sx={{ color: 'danger.fg' }}>Failed to load miners.</Text>
              </Box>
            )}
            {isLoading && !data && (
              view === 'grid' ? (
                <CardGridSkeleton count={9} columns={3} cardHeight={140} />
              ) : (
                <TableRowsSkeleton
                  rows={12}
                  cols={[
                    { width: 24 },
                    { width: 28, flex: 0 },
                    { flex: 1 },
                    { width: 60 },
                    { width: 60 },
                    { width: 60 },
                    { width: 60 },
                    { width: 80 },
                  ]}
                />
              )
            )}

            {data && view === 'grid' && (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))',
                  gap: 3,
                }}
              >
                {filtered.map((m) => (
                  <MinerCard
                    key={m.id}
                    miner={m}
                    rank={rankByScore.get(m.id) ?? 0}
                    isMe={m.githubUsername.toLowerCase() === me.toLowerCase()}
                    isTracked={tracked.has(m.id)}
                    onToggleTrack={() => toggle(m.id)}
                  />
                ))}
              </Box>
            )}

            {data && view === 'list' && (
              <MinerListView
                miners={filtered}
                rankByScore={rankByScore}
                me={me}
                tracked={tracked}
                onToggleTrack={toggle}
                sortKey={sortKey}
                sortDir={sortDir}
                onSortChange={onSortChange}
              />
            )}
          </Box>

          {/* Sidebar */}
          <Box sx={{ width: ['100%', null, 300], flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 3, position: ['static', null, 'sticky'], top: 'calc(var(--header-height) + 16px)', mt: [3, null, 0] }}>
            <SidebarCard title="Miners Activity">
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', alignItems: 'center', rowGap: '6px', columnGap: 2 }}>
                <Text sx={{ fontSize: 0, color: 'fg.muted' }}></Text>
                <Text sx={{ fontSize: 0, color: 'fg.muted', textAlign: 'right', fontWeight: 600 }}>PR</Text>
                <Text sx={{ fontSize: 0, color: 'fg.muted', textAlign: 'right', fontWeight: 600 }}>ISSUE</Text>

                <Text sx={{ fontSize: 1 }}>All</Text>
                <Text sx={{ fontFamily: 'mono', textAlign: 'right', fontWeight: 700 }}>{stats.counts.all}</Text>
                <Text sx={{ fontFamily: 'mono', textAlign: 'right', fontWeight: 700 }}>{stats.issueCounts.all}</Text>

                <Text sx={{ fontSize: 1 }}>Eligible</Text>
                <Text sx={{ fontFamily: 'mono', textAlign: 'right', fontWeight: 700, color: 'success.fg' }}>{stats.counts.eligible}</Text>
                <Text sx={{ fontFamily: 'mono', textAlign: 'right', fontWeight: 700, color: 'success.fg' }}>{stats.issueCounts.eligible}</Text>

                <Text sx={{ fontSize: 1 }}>Ineligible</Text>
                <Text sx={{ fontFamily: 'mono', textAlign: 'right', fontWeight: 700, color: 'fg.muted' }}>{stats.counts.ineligible}</Text>
                <Text sx={{ fontFamily: 'mono', textAlign: 'right', fontWeight: 700, color: 'fg.muted' }}>{stats.issueCounts.ineligible}</Text>
              </Box>
            </SidebarCard>

            <SidebarCard title="PR Activity">
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: 2, rowGap: '6px', mb: 2 }}>
                <Text sx={{ fontSize: 0, color: 'fg.muted', fontWeight: 600 }}>MERGED</Text>
                <Text sx={{ fontSize: 0, color: 'fg.muted', fontWeight: 600 }}>OPEN</Text>
                <Text sx={{ fontSize: 0, color: 'fg.muted', fontWeight: 600 }}>CLOSED</Text>
                <Text sx={{ fontFamily: 'mono', fontWeight: 700, color: 'success.fg' }}>{stats.pr.merged}</Text>
                <Text sx={{ fontFamily: 'mono', fontWeight: 700, color: 'success.fg' }}>{stats.pr.open}</Text>
                <Text sx={{ fontFamily: 'mono', fontWeight: 700, color: 'danger.fg' }}>{stats.pr.closed}</Text>
              </Box>
              <Bar label="Merge Rate" pct={stats.pr.mergeRate} color={stats.pr.mergeRate >= 75 ? 'var(--success-fg)' : 'var(--attention-emphasis)'} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1, fontSize: 1 }}>
                <Text sx={{ color: 'fg.muted' }}>Total $/day</Text>
                <Text sx={{ fontFamily: 'mono', fontWeight: 700, color: 'success.fg' }}>${stats.pr.totalDay.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              </Box>
            </SidebarCard>

            <SidebarCard title="Issue Activity">
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: 2, rowGap: '6px', mb: 2 }}>
                <Text sx={{ fontSize: 0, color: 'fg.muted', fontWeight: 600 }}>SOLVED</Text>
                <Text sx={{ fontSize: 0, color: 'fg.muted', fontWeight: 600 }}>OPEN</Text>
                <Text sx={{ fontSize: 0, color: 'fg.muted', fontWeight: 600 }}>CLOSED</Text>
                <Text sx={{ fontFamily: 'mono', fontWeight: 700, color: 'success.fg' }}>{stats.issue.solved}</Text>
                <Text sx={{ fontFamily: 'mono', fontWeight: 700, color: 'success.fg' }}>{stats.issue.open}</Text>
                <Text sx={{ fontFamily: 'mono', fontWeight: 700, color: 'danger.fg' }}>{stats.issue.closed}</Text>
              </Box>
              <Bar label="Solve Rate" pct={stats.issue.solveRate} color={stats.issue.solveRate >= 75 ? 'var(--success-fg)' : 'var(--attention-emphasis)'} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1, fontSize: 1 }}>
                <Text sx={{ color: 'fg.muted' }}>Total $/day</Text>
                <Text sx={{ fontFamily: 'mono', fontWeight: 700, color: 'success.fg' }}>${stats.issue.totalDay.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              </Box>
            </SidebarCard>

            <SidebarCard title="Code Impact">
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <KvRow
                  label="Lines Added"
                  value={`+${stats.code.added.toLocaleString()}`}
                  color="var(--success-fg)"
                />
                <KvRow
                  label="Lines Deleted"
                  value={`-${stats.code.deleted.toLocaleString()}`}
                  color="var(--danger-fg)"
                />
                <KvRow label="Repos Touched" value={stats.code.repos.toLocaleString()} color="var(--fg-default)" />
                <Box sx={{ mt: 1 }}>
                  <Bar
                    label="Avg Credibility"
                    pct={Math.round(stats.code.avgCred * 100)}
                    color={stats.code.avgCred >= 0.5 ? 'var(--success-fg)' : stats.code.avgCred >= 0.2 ? 'var(--attention-emphasis)' : 'var(--danger-fg)'}
                  />
                </Box>
              </Box>
            </SidebarCard>

            <LeaderboardCard
              mode={leaderboardMode}
              onModeChange={setLeaderboardMode}
              earners={stats.topEarners}
              active={stats.mostActive}
            />
          </Box>
        </Box>
      </PageLayout.Content>
    </PageLayout>
  );
}

function KvRow({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Text sx={{ color: 'fg.muted', fontSize: 1 }}>{label}</Text>
      <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color, fontSize: 2 }}>{value}</Text>
    </Box>
  );
}

function LeaderboardCard({
  mode,
  onModeChange,
  earners,
  active,
}: {
  mode: 'usd' | 'issues';
  onModeChange: (m: 'usd' | 'issues') => void;
  earners: Miner[];
  active: Miner[];
}) {
  const rows = mode === 'usd' ? earners : active;
  const colHeader = mode === 'usd' ? '$/DAY' : 'ISSUES';
  const cardTitle = mode === 'usd' ? 'Top Earners' : 'Most Active';
  return (
    <SidebarCard
      title={cardTitle}
      right={
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '2px', border: '1px solid', borderColor: 'border.default', borderRadius: 1, p: '2px' }}>
          <ToggleBtn active={mode === 'usd'} onClick={() => onModeChange('usd')}>$</ToggleBtn>
          <ToggleBtn active={mode === 'issues'} onClick={() => onModeChange('issues')}>Issues</ToggleBtn>
        </Box>
      }
    >
      <Box as="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 1 }}>
        <Box as="thead">
          <Box as="tr">
            <Box as="th" sx={{ textAlign: 'left', fontSize: '10px', color: 'fg.muted', fontWeight: 600, py: '4px' }}>#</Box>
            <Box as="th" sx={{ textAlign: 'left', fontSize: '10px', color: 'fg.muted', fontWeight: 600, py: '4px' }}>MINER</Box>
            <Box as="th" sx={{ textAlign: 'right', fontSize: '10px', color: 'fg.muted', fontWeight: 600, py: '4px' }}>{colHeader}</Box>
          </Box>
        </Box>
        <Box as="tbody">
          {rows.map((m, i) => (
            <Box as="tr" key={m.id} sx={{ borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'border.muted' }}>
              <Box as="td" sx={{ py: '6px', color: 'fg.muted', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', width: 22 }}>{i + 1}</Box>
              <Box as="td" sx={{ py: '6px' }}>
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://github.com/${m.githubUsername}.png?size=40`}
                    alt={m.githubUsername}
                    loading="lazy"
                    style={{ width: 18, height: 18, borderRadius: '50%', border: '1px solid var(--border-muted)' }}
                  />
                  <Text sx={{ fontWeight: 500, color: 'fg.default' }}>{m.githubUsername}</Text>
                </Box>
              </Box>
              <Box
                as="td"
                sx={{
                  py: '6px',
                  textAlign: 'right',
                  fontFamily: 'mono',
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 700,
                  color: mode === 'usd' ? 'success.fg' : 'fg.default',
                }}
              >
                {mode === 'usd' ? fmtUsd(num(m.usdPerDay)) : (m.totalOpenIssues ?? 0).toLocaleString()}
              </Box>
            </Box>
          ))}
          {rows.length === 0 && (
            <Box as="tr">
              <Box as="td" colSpan={3} sx={{ py: 2, color: 'fg.muted', textAlign: 'center', fontSize: 0 }}>
                No miners in scope.
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    </SidebarCard>
  );
}

function ToggleBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Box
      as="button"
      onClick={onClick}
      sx={{
        px: 2,
        py: '2px',
        border: 'none',
        bg: active ? 'var(--bg-emphasis)' : 'transparent',
        color: active ? 'var(--fg-default)' : 'var(--fg-muted)',
        borderRadius: 1,
        fontSize: '11px',
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
        '&:hover': { color: 'var(--fg-default)' },
      }}
    >
      {children}
    </Box>
  );
}

function ViewToggleBtn({ active, onClick, aria, children }: { active: boolean; onClick: () => void; aria: string; children: React.ReactNode }) {
  return (
    <Box
      as="button"
      onClick={onClick}
      aria-label={aria}
      title={aria}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        border: '1px solid',
        borderColor: active ? 'var(--border-default)' : 'transparent',
        borderRadius: 1,
        bg: active ? 'var(--bg-emphasis)' : 'transparent',
        color: active ? 'var(--fg-default)' : 'var(--fg-muted)',
        cursor: 'pointer',
      }}
    >
      {children}
    </Box>
  );
}

function SidebarCard({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.subtle', p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, gap: 2 }}>
        <Heading sx={{ fontSize: 2, fontWeight: 700 }}>{title}</Heading>
        {right}
      </Box>
      <Box sx={{ borderTop: '1px solid', borderColor: 'border.muted', pt: 2 }}>{children}</Box>
    </Box>
  );
}

function Bar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: '4px', fontSize: 1 }}>
        <Text sx={{ color: 'fg.default' }}>{label}</Text>
        <Text sx={{ fontFamily: 'mono', fontWeight: 700 }} style={{ color }}>{pct}%</Text>
      </Box>
      <Box sx={{ width: '100%', height: 6, bg: 'canvas.inset', borderRadius: 999, overflow: 'hidden' }}>
        <Box sx={{ height: '100%' }} style={{ width: `${pct}%`, backgroundColor: color }} />
      </Box>
    </Box>
  );
}

function CredibilityRing({ value, size = 56, dim = false }: { value: number; size?: number; dim?: boolean }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, value));
  const offset = c * (1 - pct);
  const stroke = pct >= 0.5 ? 'var(--success-emphasis)' : pct >= 0.2 ? 'var(--attention-emphasis)' : 'var(--fg-muted)';
  return (
    <Box sx={{ position: 'relative', width: size, height: size, opacity: dim ? 0.5 : 1, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--border-default)" strokeWidth={4} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={stroke}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {pct > 0 && (
          <circle
            cx={size / 2 + r * Math.cos(2 * Math.PI * pct - Math.PI / 2)}
            cy={size / 2 + r * Math.sin(2 * Math.PI * pct - Math.PI / 2)}
            r={3}
            fill="var(--danger-fg)"
          />
        )}
      </svg>
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '11px',
          fontWeight: 700,
          fontFamily: 'mono',
          color: stroke,
        }}
      >
        {Math.round(pct * 100)}%
      </Box>
    </Box>
  );
}

function MinerCard({
  miner,
  rank,
  isMe,
  isTracked,
  onToggleTrack,
}: {
  miner: Miner;
  rank: number;
  isMe: boolean;
  isTracked: boolean;
  onToggleTrack: () => void;
}) {
  const dim = !miner.isIssueEligible;
  const usd = num(miner.usdPerDay);
  // Donut + score in cards reflect issue-context (matches gittensor.io discoveries)
  const cred = num(miner.issueCredibility ?? miner.credibility);
  const score = num(miner.issueDiscoveryScore);
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: isMe ? 'accent.emphasis' : 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
        p: 3,
        opacity: dim ? 0.55 : 1,
        transition: 'border-color 80ms, transform 80ms',
        '&:hover': { borderColor: isMe ? 'accent.emphasis' : 'border.muted' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://github.com/${miner.githubUsername}.png?size=64`}
          alt={miner.githubUsername}
          loading="lazy"
          style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--border-muted)' }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
            <Text sx={{ fontWeight: 700, fontSize: 2, color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {miner.githubUsername}
            </Text>
            <Text sx={{ color: 'fg.muted', fontSize: 1 }}>#{rank}</Text>
            {isMe && (
              <Label variant="accent" sx={{ ml: 1, fontSize: '10px' }}>
                you
              </Label>
            )}
          </Box>
          {!miner.isIssueEligible && (
            <Label
              variant="secondary"
              sx={{ mt: '2px', fontSize: '10px', color: 'fg.muted' }}
              title="Not eligible for issue-discovery rewards"
            >
              INELIGIBLE
            </Label>
          )}
        </Box>
        <Box
          as="button"
          onClick={onToggleTrack}
          aria-label={isTracked ? 'Untrack miner' : 'Track miner'}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            bg: 'transparent',
            border: 'none',
            borderRadius: 1,
            color: isTracked ? 'attention.fg' : 'fg.muted',
            cursor: 'pointer',
            '&:hover': { bg: 'canvas.inset', color: 'attention.fg' },
          }}
        >
          {isTracked ? <StarFillIcon size={14} /> : <StarIcon size={14} />}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, mb: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
            <Text sx={{ fontSize: 5, fontWeight: 700, color: dim ? 'fg.muted' : 'success.fg', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums' }}>
              {fmtUsd(usd)}
            </Text>
            <Text sx={{ color: 'fg.muted', fontSize: 1 }}>/day</Text>
          </Box>
          <Text sx={{ fontSize: 0, color: 'fg.muted', fontFamily: 'mono' }}>{fmtMonthly(usd)}</Text>
        </Box>
        <CredibilityRing value={cred} dim={dim} />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, pt: 2, borderTop: '1px solid', borderColor: 'border.muted' }}>
        <StatCol label="SOLVED" value={miner.totalSolvedIssues ?? 0} color="var(--success-fg)" />
        <StatCol label="OPEN" value={miner.totalOpenIssues ?? 0} color="var(--fg-default)" />
        <StatCol label="CLOSED" value={miner.totalClosedIssues ?? 0} color="var(--danger-fg)" />
        <StatCol label="SCORE" value={score.toFixed(2)} color="var(--fg-default)" align="right" />
      </Box>
    </Box>
  );
}

function StatCol({ label, value, color, align = 'left' }: { label: string; value: string | number; color: string; align?: 'left' | 'right' }) {
  return (
    <Box sx={{ textAlign: align }}>
      <Text sx={{ display: 'block', fontSize: '10px', color: 'fg.muted', letterSpacing: '0.5px', fontWeight: 600 }}>{label}</Text>
      <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color, fontSize: 2 }}>{value}</Text>
    </Box>
  );
}

function MinerListView({
  miners,
  rankByScore,
  me,
  tracked,
  onToggleTrack,
  sortKey,
  sortDir,
  onSortChange,
}: {
  miners: Miner[];
  rankByScore: Map<string, number>;
  me: string;
  tracked: Set<string>;
  onToggleTrack: (id: string) => void;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSortChange: (k: SortKey) => void;
}) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.subtle', overflowX: 'auto', overflowY: 'hidden' }}>
      <Box as="table" sx={{ width: '100%', minWidth: 820, borderCollapse: 'collapse', fontSize: 1 }}>
        <Box as="thead" sx={{ bg: 'canvas.subtle', borderBottom: '1px solid', borderColor: 'border.default' }}>
          <Box as="tr">
            <Th width={60} sortKey="score" current={sortKey} dir={sortDir} onSort={onSortChange}>RANK</Th>
            <Th>MINER</Th>
            <Th align="right" sortKey="earnings" current={sortKey} dir={sortDir} onSort={onSortChange}>EARNINGS/DAY</Th>
            <Th align="center" sortKey="issues" current={sortKey} dir={sortDir} onSort={onSortChange}>ISSUES</Th>
            <Th align="right" sortKey="credibility" current={sortKey} dir={sortDir} onSort={onSortChange}>CREDIBILITY</Th>
            <Th align="right" sortKey="score" current={sortKey} dir={sortDir} onSort={onSortChange}>SCORE</Th>
            <Th width={32} />
          </Box>
        </Box>
        <Box as="tbody">
          {miners.map((m) => {
            const dim = !m.isIssueEligible;
            const isMe = m.githubUsername.toLowerCase() === me.toLowerCase();
            const rank = rankByScore.get(m.id) ?? 0;
            return (
              <Box
                as="tr"
                key={m.id}
                sx={{
                  borderBottom: '1px solid',
                  borderColor: 'border.muted',
                  bg: isMe ? 'var(--accent-subtle)' : 'transparent',
                  '&:hover': { bg: 'canvas.default' },
                  '&:last-child': { borderBottom: 'none' },
                  opacity: dim ? 0.55 : 1,
                }}
              >
                <Box as="td" sx={{ p: 2, verticalAlign: 'middle' }}>
                  <Box
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 28,
                      height: 24,
                      px: 1,
                      border: '1px solid',
                      borderColor: rank <= 3 ? 'var(--attention-emphasis)' : 'border.default',
                      borderRadius: 1,
                      fontFamily: 'mono',
                      fontWeight: 700,
                      fontSize: 0,
                      color: rank <= 3 ? 'var(--attention-emphasis)' : 'fg.default',
                    }}
                  >
                    {rank}
                  </Box>
                </Box>
                <Box as="td" sx={{ p: 2, verticalAlign: 'middle' }}>
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://github.com/${m.githubUsername}.png?size=48`}
                      alt={m.githubUsername}
                      loading="lazy"
                      style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--border-muted)' }}
                    />
                    <Text sx={{ fontWeight: 600, color: isMe ? 'accent.fg' : 'fg.default' }}>{m.githubUsername}</Text>
                    {isMe && <Label variant="accent" sx={{ fontSize: '10px' }}>you</Label>}
                  </Box>
                </Box>
                <Box as="td" sx={{ p: 2, textAlign: 'right', verticalAlign: 'middle' }}>
                  <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: dim ? 'fg.muted' : 'success.fg' }}>
                    {fmtUsd(num(m.usdPerDay))}
                  </Text>
                </Box>
                <Box as="td" sx={{ p: 2, textAlign: 'center', verticalAlign: 'middle' }}>
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontSize: 1 }}>
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bg: 'success.emphasis' }} />
                      <Text>{m.totalSolvedIssues ?? 0}</Text>
                    </Box>
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bg: 'fg.muted' }} />
                      <Text>{m.totalOpenIssues ?? 0}</Text>
                    </Box>
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bg: 'danger.emphasis' }} />
                      <Text>{m.totalClosedIssues ?? 0}</Text>
                    </Box>
                  </Box>
                </Box>
                <Box as="td" sx={{ p: 2, textAlign: 'right', verticalAlign: 'middle' }}>
                  <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'fg.default' }}>
                    {fmtPct(m.issueCredibility ?? m.credibility)}
                  </Text>
                </Box>
                <Box as="td" sx={{ p: 2, textAlign: 'right', verticalAlign: 'middle' }}>
                  <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'fg.default' }}>
                    {num(m.issueDiscoveryScore).toFixed(2)}
                  </Text>
                </Box>
                <Box as="td" sx={{ p: 2, textAlign: 'center', verticalAlign: 'middle' }}>
                  <Box
                    as="button"
                    onClick={() => onToggleTrack(m.id)}
                    aria-label={tracked.has(m.id) ? 'Untrack miner' : 'Track miner'}
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 24,
                      height: 24,
                      bg: 'transparent',
                      border: 'none',
                      borderRadius: 1,
                      color: tracked.has(m.id) ? 'attention.fg' : 'fg.muted',
                      cursor: 'pointer',
                      '&:hover': { bg: 'canvas.inset', color: 'attention.fg' },
                    }}
                  >
                    {tracked.has(m.id) ? <StarFillIcon size={14} /> : <StarIcon size={14} />}
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

function Th({
  children,
  align = 'left',
  width,
  sortKey,
  current,
  dir,
  onSort,
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number;
  sortKey?: SortKey;
  current?: SortKey;
  dir?: 'asc' | 'desc';
  onSort?: (k: SortKey) => void;
}) {
  const isSortable = !!sortKey && !!onSort;
  const active = isSortable && current === sortKey;
  return (
    <Box
      as="th"
      onClick={isSortable && sortKey ? () => onSort!(sortKey) : undefined}
      sx={{
        p: 2,
        textAlign: align,
        width,
        fontWeight: 600,
        fontSize: '11px',
        color: active ? 'fg.default' : 'fg.muted',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        whiteSpace: 'nowrap',
        cursor: isSortable ? 'pointer' : 'default',
        userSelect: 'none',
        '&:hover': isSortable ? { color: 'fg.default' } : undefined,
      }}
    >
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start' }}>
        {active && (dir === 'desc' ? <TriangleDownIcon size={12} /> : <TriangleUpIcon size={12} />)}
        {children}
      </Box>
    </Box>
  );
}
