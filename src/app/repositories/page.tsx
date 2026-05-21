'use client';

export const dynamic = 'force-dynamic';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PageLayout, Text, Box, TextInput, Label } from '@primer/react';
import {
  SearchIcon,
  StarIcon,
  StarFillIcon,
  TriangleDownIcon,
  TriangleUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  GitPullRequestIcon,
  GitMergeIcon,
} from '@primer/octicons-react';
import { SkeletonBar } from '@/components/Skeleton';
import { isTracked as repoIsTracked, useTrackedRepos } from '@/lib/tracked-repos';
import { formatRelativeTime, formatCount, formatPercent, formatUsd, formatTao, formatWeightPct } from '@/lib/format';
import type { GtRepo, GtReposResponse, RepoMinersResponse, GtRepoPrsResponse } from '@/types/entities';

const STALE_PR_MS = 14 * 24 * 60 * 60 * 1000;
const STALE_MIN_WEIGHT = 0.01;
const OPPORTUNITY_LIMIT = 5;

function emissionForWeight(
  weight: number,
  prices: PricesResponse | undefined,
): { tao: number | null; usd: number | null } {
  const tao = weight > 0 && prices && prices.tao_per_day > 0 ? weight * prices.tao_per_day : null;
  const usd = tao != null && prices && prices.tao_usd > 0 ? tao * prices.tao_usd : null;
  return { tao, usd };
}

interface PricesResponse {
  tao_usd: number;
  alpha_tao: number;
  alpha_usd: number;
  tao_per_day: number;
  tao_usd_change_24h: number | null;
  fetched_at: number;
}

type SortKey = 'weight' | 'emission' | 'capacity' | 'openIssues' | 'lastMerge' | 'fullName';
type StatusFilter = 'all' | 'active' | 'inactive';

const PAGE_SIZES = [10, 12, 25, 50, 100];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'weight', label: 'Weight' },
  { key: 'emission', label: 'Emission/day' },
  { key: 'capacity', label: 'Capacity' },
  { key: 'openIssues', label: 'Open Work' },
  { key: 'lastMerge', label: 'Last merge' },
  { key: 'fullName', label: 'Repository' },
];

function capacityUtilization(r: GtRepo): number {
  // Gittensor's open-PR pressure is per miner within a repo. Use the busiest
  // author's open PR count against the base threshold instead of averaging
  // across contributors, which can hide a single overloaded author.
  const thr = r.excessivePrPenaltyThreshold ?? 0;
  if (thr <= 0) return 0;
  return r.openPrMaxByAuthor / thr;
}

function avatarUrl(owner: string): string {
  return `https://github.com/${owner}.png?size=48`;
}

// True only for activation on a nested interactive element, not the row
// itself (which carries role="button"). Used to skip row expand/collapse
// when the user clicks the repo link or star button.
function isInteractiveTarget(e: { target: EventTarget | null; currentTarget: EventTarget | null }): boolean {
  if (!(e.target instanceof Element) || !(e.currentTarget instanceof Element)) return false;
  const nearest = e.target.closest('a, button, input, select, textarea, [role="button"]');
  return !!nearest && nearest !== e.currentTarget;
}

export default function RepositoriesPage() {
  const { tracked, toggle } = useTrackedRepos();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('weight');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [pageSize, setPageSize] = useState<number>(10);
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);

  const { data, isLoading, isError } = useQuery<GtReposResponse>({
    queryKey: ['gt-repositories'],
    queryFn: async () => {
      const r = await fetch('/api/gt/repositories');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  const { data: prices } = useQuery<PricesResponse>({
    queryKey: ['prices'],
    queryFn: async () => {
      const r = await fetch('/api/prices');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    if (!data?.repos) return [] as GtRepo[];
    const q = query.trim().toLowerCase();
    let list = data.repos.filter((r) => {
      // "Active" matches the KPI: isActive AND weight > 0. Zero-weight repos
      // fall under "Inactive" even when SN74 hasn't deprioritized them yet.
      const isEarning = r.isActive && r.weight > 0;
      if (status === 'active' && !isEarning) return false;
      if (status === 'inactive' && isEarning) return false;
      if (q && !r.fullName.toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'weight') cmp = a.weight - b.weight;
      else if (sortKey === 'emission') cmp = a.weight - b.weight;
      else if (sortKey === 'capacity') cmp = capacityUtilization(a) - capacityUtilization(b);
      else if (sortKey === 'openIssues') cmp = a.openIssueCount - b.openIssueCount;
      else if (sortKey === 'lastMerge') {
        const at = a.lastPrAt ? Date.parse(a.lastPrAt) : 0;
        const bt = b.lastPrAt ? Date.parse(b.lastPrAt) : 0;
        cmp = at - bt;
      } else if (sortKey === 'fullName') cmp = a.fullName.localeCompare(b.fullName);
      if (cmp === 0) cmp = sortKey === 'fullName' ? 0 : a.weight - b.weight;
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return list;
  }, [data, query, status, sortKey, sortDir]);

  const { underutilized, openWork, goingStale } = useMemo(() => {
    const empty = { underutilized: [] as GtRepo[], openWork: [] as GtRepo[], goingStale: [] as GtRepo[] };
    if (!data?.repos) return empty;
    const active = data.repos.filter((r) => r.isActive);

    // Threshold is per miner. Repos without a configured threshold are skipped
    // because headroom is unknowable.
    const utilization = (r: GtRepo): number | null => {
      const thr = r.excessivePrPenaltyThreshold;
      if (thr == null || thr <= 0) return null;
      return r.openPrMaxByAuthor / thr;
    };
    const underutilized = active
      .map((r) => ({ r, u: utilization(r) }))
      .filter(({ r, u }) => r.weight > 0 && u != null && u < 1)
      .sort((a, b) => b.r.weight / Math.max(b.u!, 0.05) - a.r.weight / Math.max(a.u!, 0.05))
      .slice(0, OPPORTUNITY_LIMIT)
      .map(({ r }) => r);

    const openWork = [...active]
      .filter((r) => r.openIssueCount > 0)
      .sort((a, b) => b.openIssueCount - a.openIssueCount)
      .slice(0, OPPORTUNITY_LIMIT);

    const staleCutoff = Date.now() - STALE_PR_MS;
    const goingStale = active
      .filter((r) => {
        if (r.weight <= STALE_MIN_WEIGHT) return false;
        if (!r.lastPrAt) return true;
        return Date.parse(r.lastPrAt) < staleCutoff;
      })
      .sort((a, b) => {
        const at = a.lastPrAt ? Date.parse(a.lastPrAt) : 0;
        const bt = b.lastPrAt ? Date.parse(b.lastPrAt) : 0;
        return at - bt;
      })
      .slice(0, OPPORTUNITY_LIMIT);

    return { underutilized, openWork, goingStale };
  }, [data]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageItems = filtered.slice(pageStart, pageStart + pageSize);

  return (
    <PageLayout containerWidth="full" padding="normal">
      <PageLayout.Content>
        <NetworkKpiStrip data={data} prices={prices} />

        <Box
          sx={{
            display: 'flex',
            flexDirection: ['column', null, null, 'row'],
            alignItems: 'flex-start',
            gap: 2,
          }}
        >
          {/* Main column */}
          <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
        {/* Toolbar — detached card, matching /pulls visual rhythm. */}
        <Box
          sx={{
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 2,
            bg: 'canvas.subtle',
            p: 2,
            mb: 2,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              // Single-row toolbar from sm (≥544px) up. Below that, search drops to its
              // own row but tabs + row-count stay inline so the toolbar isn't a tall column.
              flexDirection: 'row',
              alignItems: 'center',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, maxWidth: '100%', overflowX: 'auto' }}>
              <StatusTab active={status === 'all'} onClick={() => { setStatus('all'); setPage(1); }} label="All" count={data?.count} />
              <StatusTab active={status === 'active'} onClick={() => { setStatus('active'); setPage(1); }} label="Active" count={data?.activeCount} />
              <StatusTab active={status === 'inactive'} onClick={() => { setStatus('inactive'); setPage(1); }} label="Inactive" count={data?.inactiveCount} />
            </Box>

            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'fg.muted', fontSize: 1 }}>
              <Text sx={{ color: 'fg.muted' }}>Sort:</Text>
              <Box
                as="select"
                value={sortKey}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setSortKey(e.target.value as SortKey); setPage(1); }}
                sx={{
                  bg: 'canvas.default',
                  color: 'fg.default',
                  border: '1px solid',
                  borderColor: 'border.default',
                  borderRadius: 1,
                  px: 1,
                  py: '2px',
                  fontSize: 1,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </Box>
              <Box
                as="button"
                onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                aria-label={sortDir === 'desc' ? 'Sort descending' : 'Sort ascending'}
                title={sortDir === 'desc' ? 'Descending' : 'Ascending'}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 24,
                  height: 24,
                  bg: 'canvas.default',
                  color: 'fg.default',
                  border: '1px solid',
                  borderColor: 'border.default',
                  borderRadius: 1,
                  cursor: 'pointer',
                  '&:hover': { borderColor: 'border.muted' },
                }}
              >
                {sortDir === 'desc' ? <ArrowDownIcon size={14} /> : <ArrowUpIcon size={14} />}
              </Box>
            </Box>

            {/* Pushes Rows + Search to the right edge on wide viewports.
                On narrow viewports they wrap below tabs/sort naturally. */}
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'fg.muted', fontSize: 1, ml: ['0', 'auto'] }}>
              <Text sx={{ color: 'fg.muted' }}>Rows:</Text>
              <Box
                as="select"
                value={pageSize}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                sx={{
                  bg: 'canvas.default',
                  color: 'fg.default',
                  border: '1px solid',
                  borderColor: 'border.default',
                  borderRadius: 1,
                  px: 1,
                  py: '2px',
                  fontSize: 1,
                  cursor: 'pointer',
                }}
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </Box>
            </Box>

            <Box sx={{ minWidth: 200, width: ['100%', 240] }}>
              <TextInput
                leadingVisual={SearchIcon}
                placeholder="Search or enter owner/name…"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1); }}
                sx={{ width: '100%' }}
              />
            </Box>
          </Box>
        </Box>

        {isError && (
          <Box sx={{ p: 3, border: '1px solid', borderColor: 'danger.emphasis', bg: 'danger.subtle', borderRadius: 2, mb: 2 }}>
            <Text sx={{ color: 'danger.fg' }}>Failed to load repositories.</Text>
          </Box>
        )}
        {isLoading && !data && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Box
                key={i}
                sx={{
                  border: '1px solid',
                  borderColor: 'border.muted',
                  borderRadius: 2,
                  bg: 'canvas.subtle',
                  overflow: 'hidden',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 3, py: '12px' }}>
                  <SkeletonBar width={14} />
                  <SkeletonBar width={28} />
                  <Box sx={{ width: 22, height: 22, borderRadius: '50%', bg: 'canvas.inset' }} />
                  <SkeletonBar width={180} />
                </Box>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: ['repeat(2, 1fr)', 'repeat(3, 1fr)', 'repeat(6, 1fr)'],
                    gap: '1px',
                    bg: 'border.muted',
                    borderTop: '1px solid',
                    borderColor: 'border.muted',
                  }}
                >
                  {Array.from({ length: 6 }).map((_, j) => (
                    <Box key={j} sx={{ bg: 'canvas.subtle', px: 3, py: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <SkeletonBar width={60} />
                      <SkeletonBar width={80} />
                    </Box>
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        )}

        {data && (
          <>
            {/* Below lg: card view (vertical stack, no horizontal scroll). */}
            <Box sx={{ display: ['block', null, null, 'none'] }}>
              <RepoCardList
                rows={pageItems}
                startRank={pageStart + 1}
                tracked={tracked}
                onToggleTrack={toggle}
                prices={prices}
                expandedRepo={expandedRepo}
                onToggleExpand={(fullName) =>
                  setExpandedRepo((cur) => (cur === fullName ? null : fullName))
                }
              />
            </Box>
            {/* lg+: dense table view with sortable column headers. */}
            <Box sx={{ display: ['none', null, null, 'block'] }}>
              <RepoTable
                rows={pageItems}
                startRank={pageStart + 1}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={(k) => {
                  if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                  else {
                    setSortKey(k);
                    setSortDir('desc');
                  }
                  setPage(1);
                }}
                tracked={tracked}
                onToggleTrack={toggle}
                prices={prices}
                expandedRepo={expandedRepo}
                onToggleExpand={(fullName) =>
                  setExpandedRepo((cur) => (cur === fullName ? null : fullName))
                }
              />
            </Box>
          </>
        )}

        {data && (
          <Box
            sx={{
              mt: 2,
              px: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: ['space-between', null, 'flex-end'],
              gap: 2,
              flexWrap: 'wrap',
              color: 'fg.muted',
              fontSize: 1,
            }}
          >
            <Text>
              {filtered.length === 0
                ? '0 of 0'
                : `${pageStart + 1}-${Math.min(pageStart + pageSize, filtered.length)} of ${filtered.length}`}
            </Text>
            <PageBtn onClick={() => setPage(1)} disabled={safePage <= 1} aria="First page">|‹</PageBtn>
            <PageBtn onClick={() => setPage(safePage - 1)} disabled={safePage <= 1} aria="Previous page">
              <ChevronLeftIcon size={14} />
            </PageBtn>
            <PageBtn onClick={() => setPage(safePage + 1)} disabled={safePage >= totalPages} aria="Next page">
              <ChevronRightIcon size={14} />
            </PageBtn>
            <PageBtn onClick={() => setPage(totalPages)} disabled={safePage >= totalPages} aria="Last page">›|</PageBtn>
          </Box>
        )}
          </Box>

          {/* Right sidebar — Opportunities */}
          <Box
            sx={{
              width: ['100%', null, null, 320],
              flexShrink: 0,
              position: ['static', null, null, 'sticky'],
              top: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <OpportunityCard
              title="Underutilized capacity"
              hint="High weight, below base per-author PR pressure"
              accent="success"
              rows={underutilized}
              empty="No repos with open capacity right now."
              renderRight={(r) => {
                const thr = r.excessivePrPenaltyThreshold ?? 0;
                return (
                  <Box sx={{ textAlign: 'right' }}>
                    <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'fg.default' }}>
                      {formatWeightPct(r.weight)}
                    </Text>
                    <Text
                      sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}
                      title={`${r.openPrCount} open PRs across ${r.openPrAuthorCount} author${r.openPrAuthorCount === 1 ? '' : 's'}; busiest author has ${r.openPrMaxByAuthor}`}
                    >
                      max {r.openPrMaxByAuthor}/{thr > 0 ? thr : '∞'}
                    </Text>
                  </Box>
                );
              }}
            />
            <OpportunityCard
              title="Open work available"
              hint="Issues waiting for an owner"
              accent="accent"
              rows={openWork}
              empty="No open issues across tracked repos."
              renderRight={(r) => (
                <Box sx={{ textAlign: 'right' }}>
                  <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'fg.default' }}>
                    {formatCount(r.openIssueCount)}
                  </Text>
                  <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>open</Text>
                </Box>
              )}
            />
            <OpportunityCard
              title="Going stale"
              hint="No recent merges, still weighted"
              accent="attention"
              rows={goingStale}
              empty="No stale repos — nice."
              renderRight={(r) => (
                <Box sx={{ textAlign: 'right' }}>
                  <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'fg.default' }}>
                    {formatWeightPct(r.weight)}
                  </Text>
                  <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>
                    {r.lastPrAt ? formatRelativeTime(r.lastPrAt) : 'never'}
                  </Text>
                </Box>
              )}
            />
          </Box>
        </Box>
      </PageLayout.Content>
    </PageLayout>
  );
}

type AccentTone = 'success' | 'accent' | 'attention' | 'danger';

function OpportunityCard({
  title,
  hint,
  accent,
  rows,
  empty,
  renderRight,
}: {
  title: string;
  hint: string;
  accent: AccentTone;
  rows: GtRepo[];
  empty: string;
  renderRight: (r: GtRepo) => React.ReactNode;
}) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 2,
          px: 3,
          pt: 2,
          pb: 2,
          borderBottom: '1px solid',
          borderColor: 'border.muted',
        }}
      >
        <Box
          aria-hidden
          sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            bg: `${accent}.emphasis`,
            mt: '6px',
            flexShrink: 0,
          }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Text
            sx={{
              display: 'block',
              fontSize: 1,
              fontWeight: 600,
              color: 'fg.default',
              lineHeight: 1.3,
            }}
          >
            {title}
          </Text>
          <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted', mt: '2px' }}>{hint}</Text>
        </Box>
      </Box>
      <Box sx={{ px: 2, py: 1 }}>
        {rows.length === 0 ? (
          <EmptyHint>{empty}</EmptyHint>
        ) : (
          rows.map((r) => <SidebarRepoRow key={r.fullName} repo={r} right={renderRight(r)} />)
        )}
      </Box>
    </Box>
  );
}

function SidebarRepoRow({ repo, right }: { repo: GtRepo; right: React.ReactNode }) {
  return (
    <Link
      href={`/repos/${repo.owner}/${repo.name}`}
      prefetch={false}
      style={{ display: 'block', minWidth: 0, textDecoration: 'none' }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          minWidth: 0,
          py: '6px',
          px: 1,
          borderRadius: 1,
          '&:hover': { bg: 'canvas.default' },
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl(repo.owner)}
          alt={repo.owner}
          loading="lazy"
          style={{ width: 18, height: 18, borderRadius: '50%', border: '1px solid var(--border-muted)', flexShrink: 0 }}
        />
        <Text
          sx={{
            flex: 1,
            minWidth: 0,
            color: 'fg.default',
            fontWeight: 500,
            fontSize: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={repo.fullName}
        >
          {repo.fullName}
        </Text>
        <Box sx={{ flexShrink: 0 }}>{right}</Box>
      </Box>
    </Link>
  );
}

function formatYearlyUsd(daily: number): string {
  const yearly = daily * 365;
  if (yearly >= 1_000_000) return `$${(yearly / 1_000_000).toFixed(1)}M/yr`;
  if (yearly >= 1_000) return `$${Math.round(yearly / 1_000)}k/yr`;
  return `$${Math.round(yearly)}/yr`;
}

function formatLatencyHours(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return '—';
  if (h < 24) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function NetworkKpiStrip({
  data,
  prices,
}: {
  data: GtReposResponse | undefined;
  prices: PricesResponse | undefined;
}) {
  const activeCount = data?.activeCount ?? 0;
  const totalCount = data?.count ?? 0;
  const stakedCount = data?.stakedRepoCount ?? 0;
  const weight = data?.totalEmissionWeight ?? 0;
  const top5Share = data?.top5WeightConcentration ?? 0;
  const taoUsd = prices?.tao_usd ?? 0;
  const change24h = prices?.tao_usd_change_24h ?? null;
  const { tao: taoPerDay, usd: usdPerDay } = emissionForWeight(weight, prices);

  const merged7d = data?.prsMergedThisWeek ?? 0;
  const mergedPrev = data?.prsMergedLastWeek ?? 0;
  const mergedDelta = merged7d - mergedPrev;
  const mergedSeries = data?.prsMergedSeries14d ?? [];

  const contributors7d = data?.uniqueContributors7d ?? 0;
  const contributorsPrev = data?.uniqueContributorsPriorWeek ?? 0;
  const contributorsDelta = contributors7d - contributorsPrev;
  const newC = data?.newContributors7d ?? 0;
  const retC = data?.returningContributors7d ?? 0;

  const score7d = data?.scoreEarnedThisWeek ?? 0;
  const scorePrev = data?.scoreEarnedPriorWeek ?? 0;
  const scoreDelta = Math.round(score7d - scorePrev);

  const lat7d = data?.medianMergeLatencyHours7d ?? 0;
  const latPrev = data?.medianMergeLatencyHoursPriorWeek ?? 0;
  // Round to whole hours for the delta so a sub-hour difference does not
  // render a misleading arrow.
  const latDeltaHours = Math.round(lat7d - latPrev);

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        mb: 2,
        overflow: 'hidden',
      }}
    >
      {/* Single uniform grid — 2 cols xs, 4 cols sm/md/lg, 8 cols xl.
          No hero, no two-tier hierarchy: every metric carries the same
          weight, eliminating the dead space the giant headline number
          created on wide screens. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: ['repeat(2, 1fr)', 'repeat(4, 1fr)', null, null, 'repeat(8, 1fr)'],
          gap: '1px',
          bg: 'border.muted',
        }}
      >
        <SupportCell
          label="Emission · Daily"
          hint="Daily TAO going to miners on tracked repos (excludes the ~10% issue treasury), with USD equivalent."
          value={taoPerDay != null ? formatTao(taoPerDay) : formatPercent(weight, { scale: 100 })}
          sub={
            usdPerDay != null
              ? `${formatUsd(usdPerDay)}/d · ${formatYearlyUsd(usdPerDay)}`
              : 'weight share'
          }
        />
        <SupportCell
          label="τ Price"
          hint="TAO/USD spot price from CoinGecko, with 24h change."
          value={taoUsd > 0 ? formatUsd(taoUsd, { style: 'price' }) : '—'}
          sub={
            change24h == null ? (
              taoUsd > 0 ? 'TAO/USD' : 'price unavailable'
            ) : (
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <DeltaIndicator
                  value={Number(change24h.toFixed(2))}
                  direction="up-is-good"
                  format={(abs) => `${abs.toFixed(2)}%`}
                />
                <Text as="span" sx={{ fontSize: 0, color: 'fg.subtle' }}>24h</Text>
              </Box>
            )
          }
        />
        <SupportCell
          label="Active Repos"
          hint="Repos with non-zero SN74 emission weight (vs. total tracked); ‘staked’ = repos with collateral committed."
          value={
            <>
              {activeCount}
              {activeCount !== totalCount && (
                <Text as="span" sx={{ color: 'fg.muted', fontSize: 1, fontWeight: 500, ml: '2px' }}>
                  /{totalCount}
                </Text>
              )}
            </>
          }
          sub={stakedCount > 0 ? `${formatCount(stakedCount)} staked` : 'none staked'}
        />
        <SupportCell
          label="Weight Allocated"
          hint="Sum of active-repo weights — the share of SN74 emission flowing to tracked repos."
          value={formatPercent(weight, { scale: 100 })}
          sub={top5Share > 0 ? `Top 5 hold ${Math.round(top5Share * 100)}%` : 'No active weight'}
        />
        <SupportCell
          label="Merged 7d"
          hint="PRs merged into tracked repos in the last 7 days. Δ is week-over-week; the bar trend shows the last 14 days, oldest left to newest right."
          value={
            <Box sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 1 }}>
              {formatCount(merged7d, { fallback: '0' })}
              {(merged7d > 0 || mergedPrev > 0) && (
                <DeltaIndicator value={mergedDelta} direction="up-is-good" />
              )}
            </Box>
          }
          sub={
            <Box sx={{ height: 14, display: 'flex', alignItems: 'center', mt: '2px' }}>
              <Sparkline series={mergedSeries} fluid height={14} label="merged PR" />
            </Box>
          }
        />
        <SupportCell
          label="Contributors 7d"
          hint="Distinct PR authors merged in the last 7 days. ‘new’ = first-ever merge in this window; ‘ret’ = had merges before 14d ago."
          value={
            <Box sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 1 }}>
              {formatCount(contributors7d, { fallback: '0' })}
              {contributorsDelta !== 0 && (
                <DeltaIndicator value={contributorsDelta} direction="up-is-good" />
              )}
            </Box>
          }
          sub={
            contributors7d === 0
              ? 'no merged-PR authors'
              : `${formatCount(newC)} new · ${formatCount(retC)} ret`
          }
        />
        <SupportCell
          label="PR Score 7d"
          hint="Sum of official Gittensor PR scores for PRs merged in the last 7 days. This is a raw scoring metric, not TAO paid out."
          value={
            <Box sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 1 }}>
              {formatCount(Math.round(score7d), { fallback: '0' })}
              {scoreDelta !== 0 && <DeltaIndicator value={scoreDelta} direction="up-is-good" />}
            </Box>
          }
          sub="raw score"
        />
        <SupportCell
          label="Merge Latency"
          hint="Median hours between PR open and merge across PRs merged in the last 7d. Lower is faster review velocity."
          value={
            <Box sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 1 }}>
              {formatLatencyHours(lat7d)}
              {latDeltaHours !== 0 && (
                <DeltaIndicator
                  value={latDeltaHours}
                  direction="down-is-good"
                  format={(abs) => `${abs}h`}
                />
              )}
            </Box>
          }
          sub="median · last 7d"
        />
      </Box>
    </Box>
  );
}

function SupportCell({
  label,
  hint,
  value,
  sub,
}: {
  label: string;
  hint?: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <Box
      title={hint}
      sx={{
        bg: 'canvas.subtle',
        px: 3,
        py: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        minWidth: 0,
        cursor: hint ? 'help' : 'default',
      }}
    >
      <Text
        sx={{
          fontSize: '10px',
          fontWeight: 600,
          letterSpacing: '0.6px',
          color: 'fg.subtle',
          textTransform: 'uppercase',
          lineHeight: 1,
        }}
      >
        {label}
      </Text>
      <Text
        sx={{
          fontFamily: 'mono',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 700,
          fontSize: 2,
          color: 'fg.default',
          lineHeight: 1.1,
        }}
      >
        {value}
      </Text>
      {sub != null && (
        <Text
          sx={{
            fontSize: 0,
            color: 'fg.muted',
            fontFamily: 'mono',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.2,
          }}
        >
          {sub}
        </Text>
      )}
    </Box>
  );
}

function DeltaIndicator({
  value,
  direction = 'up-is-good',
  format,
}: {
  value: number;
  direction?: 'up-is-good' | 'down-is-good';
  format?: (abs: number) => string;
}) {
  if (value === 0) {
    return (
      <Text sx={{ color: 'fg.muted', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontSize: 0, fontWeight: 600 }}>
        ±0
      </Text>
    );
  }
  const up = value > 0;
  const isGood = direction === 'up-is-good' ? up : !up;
  const Icon = up ? ArrowUpIcon : ArrowDownIcon;
  const abs = Math.abs(value);
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        color: isGood ? 'success.fg' : 'danger.fg',
        fontFamily: 'mono',
        fontVariantNumeric: 'tabular-nums',
        fontSize: 0,
        fontWeight: 700,
      }}
    >
      <Icon size={12} />
      {format ? format(abs) : abs}
    </Box>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ py: 3, textAlign: 'center', color: 'fg.muted', fontSize: 1 }}>{children}</Box>
  );
}

function DetailErrorHint({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ py: 3, textAlign: 'center', color: 'danger.fg', fontSize: 1 }}>{children}</Box>
  );
}

function StatusTab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <Box
      as="button"
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: '4px',
        border: '1px solid',
        borderColor: active ? 'border.default' : 'transparent',
        borderRadius: 1,
        bg: active ? 'canvas.default' : 'transparent',
        color: active ? 'fg.default' : 'fg.muted',
        fontSize: 1,
        fontWeight: active ? 600 : 500,
        flexShrink: 0,
        cursor: 'pointer',
        fontFamily: 'inherit',
        '&:hover': { color: 'fg.default' },
      }}
    >
      <Text>{label}</Text>
      {count !== undefined && (
        <Text sx={{ color: active ? 'fg.muted' : 'fg.subtle', fontWeight: 500 }}>{count}</Text>
      )}
    </Box>
  );
}

function PageBtn({
  onClick,
  disabled,
  aria,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  aria: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      as="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={aria}
      title={aria}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 24,
        height: 24,
        px: 1,
        bg: 'transparent',
        border: '1px solid',
        borderColor: 'transparent',
        borderRadius: 1,
        color: disabled ? 'fg.subtle' : 'fg.muted',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        fontFamily: 'mono',
        fontSize: 1,
        '&:hover': disabled ? undefined : { color: 'fg.default', bg: 'canvas.default' },
      }}
    >
      {children}
    </Box>
  );
}

function RepoCardList({
  rows,
  startRank,
  tracked,
  onToggleTrack,
  prices,
  expandedRepo,
  onToggleExpand,
}: {
  rows: GtRepo[];
  startRank: number;
  tracked: Set<string>;
  onToggleTrack: (fullName: string) => void;
  prices: PricesResponse | undefined;
  expandedRepo: string | null;
  onToggleExpand: (fullName: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <Box
        sx={{
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 2,
          bg: 'canvas.subtle',
          p: 4,
          textAlign: 'center',
          color: 'fg.muted',
        }}
      >
        No repositories match.
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {rows.map((r, i) => (
        <RepoCard
          key={r.fullName}
          repo={r}
          rank={startRank + i}
          isTracked={repoIsTracked(tracked, r.fullName)}
          isExpanded={expandedRepo === r.fullName}
          prices={prices}
          onToggleTrack={onToggleTrack}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </Box>
  );
}

function RepoCard({
  repo: r,
  rank,
  isTracked,
  isExpanded,
  prices,
  onToggleTrack,
  onToggleExpand,
}: {
  repo: GtRepo;
  rank: number;
  isTracked: boolean;
  isExpanded: boolean;
  prices: PricesResponse | undefined;
  onToggleTrack: (fullName: string) => void;
  onToggleExpand: (fullName: string) => void;
}) {
  const { tao: taoPerDay, usd: usdPerDay } = emissionForWeight(r.weight, prices);
  const lastMergeMs = r.lastPrAt ? Date.parse(r.lastPrAt) : 0;
  const lastMergeStale = lastMergeMs > 0 && Date.now() - lastMergeMs > STALE_PR_MS;
  const detailId = `repo-detail-${r.owner}-${r.name}`;
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: isExpanded ? 'border.default' : 'border.muted',
        borderRadius: 2,
        bg: 'canvas.subtle',
        overflow: 'hidden',
        opacity: r.isActive ? 1 : 0.7,
        transition: 'border-color 120ms ease',
        '&:hover': { borderColor: 'border.default' },
      }}
    >
      {/* Header — clickable to expand. Star button + repo link stop
          propagation so they remain independent actions. */}
      <Box
        tabIndex={0}
        role="button"
        aria-expanded={isExpanded}
        aria-controls={detailId}
        onClick={(e: React.MouseEvent<HTMLDivElement>) => {
          if (isInteractiveTarget(e)) return;
          onToggleExpand(r.fullName);
        }}
        onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
          if (isInteractiveTarget(e)) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleExpand(r.fullName);
          } else if (e.key === 'Escape' && isExpanded) {
            e.preventDefault();
            onToggleExpand(r.fullName);
          }
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          px: 3,
          py: '12px',
          cursor: 'pointer',
          outline: 'none',
          '&:focus-visible': { boxShadow: 'inset 0 0 0 2px var(--accent-emphasis)' },
          '&:hover': { bg: 'canvas.default' },
          bg: isExpanded ? 'canvas.default' : undefined,
        }}
      >
        <Box
          aria-hidden
          sx={{
            color: 'fg.muted',
            display: 'inline-flex',
            transition: 'transform 120ms ease',
            transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            flexShrink: 0,
          }}
        >
          <ChevronDownIcon size={14} />
        </Box>
        <Text
          sx={{
            fontFamily: 'mono',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: rank <= 3 ? 700 : 500,
            fontSize: 1,
            color: rank <= 3 ? 'attention.fg' : 'fg.muted',
            minWidth: 28,
            textAlign: 'right',
            flexShrink: 0,
          }}
        >
          #{rank}
        </Text>
        <Link
          href={`/repos/${r.owner}/${r.name}`}
          prefetch={false}
          onClick={(e) => e.stopPropagation()}
          style={{ textDecoration: 'none', minWidth: 0, flex: 1 }}
        >
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              color: 'fg.default',
              minWidth: 0,
              maxWidth: '100%',
              '&:hover': { color: 'accent.fg' },
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarUrl(r.owner)}
              alt={r.owner}
              loading="lazy"
              style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--border-muted)', flexShrink: 0 }}
            />
            <Text sx={{ fontWeight: 600, fontSize: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r.fullName}
            </Text>
            {r.stars != null && r.stars > 0 && (
              <Text sx={{ color: 'fg.muted', fontSize: 0, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                ★ {formatCount(r.stars)}
              </Text>
            )}
            {!r.isActive && (
              <Label variant="secondary" sx={{ fontSize: '10px', flexShrink: 0 }}>
                INACTIVE
              </Label>
            )}
          </Box>
        </Link>
        <Box
          as="button"
          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation();
            onToggleTrack(r.fullName);
          }}
          aria-label={isTracked ? 'Untrack' : 'Track'}
          title={isTracked ? 'Untrack repository' : 'Track repository'}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            bg: 'transparent',
            border: '1px solid',
            borderColor: 'transparent',
            borderRadius: 1,
            color: isTracked ? 'attention.fg' : 'fg.muted',
            cursor: 'pointer',
            flexShrink: 0,
            '&:hover': { bg: 'canvas.inset', borderColor: 'border.muted', color: 'attention.fg' },
          }}
        >
          {isTracked ? <StarFillIcon size={14} /> : <StarIcon size={14} />}
        </Box>
      </Box>

      {/* Metrics grid — same divider-via-gap trick as the KPI strip. Five cells
          collapse to a single column on the smallest viewports. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: ['repeat(2, 1fr)', 'repeat(3, 1fr)', 'repeat(5, 1fr)'],
          gap: '1px',
          bg: 'border.muted',
          borderTop: '1px solid',
          borderColor: 'border.muted',
        }}
      >
        <RepoCell
          label="Weight"
          hint="SN74 emission weight (0–1) — the share of network emission allocated to this repo."
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 2, color: 'fg.default', lineHeight: 1.1 }}>
              {formatWeightPct(r.weight)}
            </Text>
            <Box sx={{ width: '100%', height: 3, bg: 'canvas.inset', borderRadius: 999, overflow: 'hidden' }}>
              <Box sx={{ height: '100%', bg: 'accent.emphasis' }} style={{ width: `${Math.min(100, Math.max(0, r.weight * 100))}%` }} />
            </Box>
          </Box>
        </RepoCell>
        <RepoCell
          label="Emission · Daily"
          hint="Daily TAO going to miners on this repo (excludes the ~10% issue treasury), with USD equivalent."
        >
          {taoPerDay == null ? (
            <Text sx={{ color: 'fg.muted', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontSize: 2 }}>—</Text>
          ) : (
            <>
              <Text sx={{ display: 'block', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'fg.default', fontSize: 2, lineHeight: 1.1 }}>
                {formatTao(taoPerDay)}
              </Text>
              {usdPerDay != null && (
                <Text sx={{ display: 'block', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontSize: 0, color: 'fg.muted', mt: '4px' }}>
                  {formatUsd(usdPerDay)}/d
                </Text>
              )}
            </>
          )}
        </RepoCell>
        <RepoCell
          label="Activity · 14d"
          hint="Daily merged-PR count over the past 14 days, oldest left to newest right."
        >
          <Sparkline series={r.mergedPrSeries14d} fluid height={22} />
        </RepoCell>
        <RepoCell
          label="Capacity"
          hint="Open-PR pressure: busiest author vs. the base per-author excessive-PR threshold. The validator can raise a miner's threshold with token score."
        >
          <CapacityGauge
            open={r.openPrCount}
            threshold={r.excessivePrPenaltyThreshold}
            maxByAuthor={r.openPrMaxByAuthor}
            authorCount={r.openPrAuthorCount}
          />
        </RepoCell>
        <RepoCell
          label="Open Work"
          hint="Open issues on this repo — work waiting for an owner."
        >
          <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 2, color: r.openIssueCount > 0 ? 'fg.default' : 'fg.muted', lineHeight: 1.1 }}>
            {formatCount(r.openIssueCount)}
          </Text>
          {r.openIssueCount > 0 && (
            <Text sx={{ fontSize: 0, color: 'fg.muted', mt: '4px' }}>open issues</Text>
          )}
        </RepoCell>
      </Box>

      {/* Footer — last merge + policy chips. Two stats on a single row that
          wraps gracefully when chips overflow. */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          rowGap: '8px',
          columnGap: 3,
          px: 3,
          py: 2,
          borderTop: '1px solid',
          borderColor: 'border.muted',
          bg: 'canvas.subtle',
        }}
      >
        <Box
          title="Time since the most recent merged PR. Older than 14 days is marked stale."
          sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 2, cursor: 'help', flexShrink: 0 }}
        >
          <Text sx={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.6px', color: 'fg.subtle', textTransform: 'uppercase' }}>
            Last merge
          </Text>
          {!r.lastPrAt ? (
            <Text sx={{ color: 'fg.muted', fontSize: 1 }}>never</Text>
          ) : (
            <Text sx={{ color: lastMergeStale ? 'danger.fg' : 'fg.default', fontSize: 1, fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
              {formatRelativeTime(r.lastPrAt)}
            </Text>
          )}
        </Box>
        <Box
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 2, minWidth: 0, flex: 1 }}
        >
          <Text
            title="SN74 scoring policy flags — e.g. fixed base score, trusted label pipeline, configured per-label multipliers."
            sx={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.6px', color: 'fg.subtle', textTransform: 'uppercase', flexShrink: 0, cursor: 'help' }}
          >
            Policy
          </Text>
          <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <PolicyChips repo={r} />
          </Box>
        </Box>
      </Box>

      {isExpanded && (
        <Box id={detailId} sx={{ borderTop: '1px solid', borderColor: 'border.muted', bg: 'canvas.inset' }}>
          <ExpandedRowDetail repo={r} />
        </Box>
      )}
    </Box>
  );
}

function RepoCell({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      title={hint}
      sx={{
        bg: 'canvas.subtle',
        px: 3,
        py: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        minWidth: 0,
        cursor: hint ? 'help' : 'default',
      }}
    >
      <Text
        sx={{
          fontSize: '10px',
          fontWeight: 600,
          letterSpacing: '0.6px',
          color: 'fg.subtle',
          textTransform: 'uppercase',
          lineHeight: 1,
        }}
      >
        {label}
      </Text>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

// ─── Desktop table view ─────────────────────────────────────────────────────
// Same data as `RepoCard`, dense row layout. Shown at lg+ where the horizontal
// real estate is sufficient for the column-based comparison.

function RepoTable({
  rows,
  startRank,
  sortKey,
  sortDir,
  onSort,
  tracked,
  onToggleTrack,
  prices,
  expandedRepo,
  onToggleExpand,
}: {
  rows: GtRepo[];
  startRank: number;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
  tracked: Set<string>;
  onToggleTrack: (fullName: string) => void;
  prices: PricesResponse | undefined;
  expandedRepo: string | null;
  onToggleExpand: (fullName: string) => void;
}) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.default',
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      <Box as="table" sx={{ width: '100%', minWidth: 1100, borderCollapse: 'collapse', fontSize: 1 }}>
        <Box as="thead" sx={{ bg: 'canvas.subtle', borderBottom: '1px solid', borderColor: 'border.default' }}>
          <Box as="tr">
            <Th width={56} hint="Position in the current sort order.">#</Th>
            <Th
              sortKey="fullName"
              current={sortKey}
              dir={sortDir}
              onSort={onSort}
              hint="Repository owner/name. Click to sort alphabetically."
            >
              Repository
            </Th>
            <Th
              align="right"
              sortKey="weight"
              current={sortKey}
              dir={sortDir}
              onSort={onSort}
              hint="SN74 emission weight (0–1) — the share of network emission allocated to this repo."
            >
              Weight
            </Th>
            <Th
              align="right"
              sortKey="emission"
              current={sortKey}
              dir={sortDir}
              onSort={onSort}
              hint="Daily TAO going to miners on this repo (excludes the ~10% issue treasury), with USD equivalent."
            >
              Emission/d
            </Th>
            <Th align="left" hint="Daily merged-PR count over the past 14 days, oldest left to newest right.">
              Activity 14d
            </Th>
            <Th
              align="left"
              sortKey="capacity"
              current={sortKey}
              dir={sortDir}
              onSort={onSort}
              hint="Open-PR pressure: busiest author vs. the base per-author excessive-PR threshold. The validator can raise a miner's threshold with token score."
            >
              Capacity
            </Th>
            <Th
              align="right"
              sortKey="openIssues"
              current={sortKey}
              dir={sortDir}
              onSort={onSort}
              hint="Open issues on this repo — work waiting for an owner."
            >
              Open Work
            </Th>
            <Th
              align="right"
              sortKey="lastMerge"
              current={sortKey}
              dir={sortDir}
              onSort={onSort}
              hint="Time since the most recent merged PR. Older than 14 days is marked stale."
            >
              Last Merge
            </Th>
            <Th
              align="left"
              hint="SN74 scoring policy flags — e.g. fixed base score, trusted label pipeline, configured per-label multipliers."
            >
              Policy
            </Th>
            <Th align="center" width={36} hint="Track this repository to surface it in your personal dashboard.">
              ★
            </Th>
          </Box>
        </Box>
        <Box as="tbody">
          {rows.map((r, i) => {
            const rank = startRank + i;
            const isTracked = repoIsTracked(tracked, r.fullName);
            const { tao: taoPerDay, usd: usdPerDay } = emissionForWeight(r.weight, prices);
            const lastMergeMs = r.lastPrAt ? Date.parse(r.lastPrAt) : 0;
            const lastMergeStale = lastMergeMs > 0 && Date.now() - lastMergeMs > STALE_PR_MS;
            const isExpanded = expandedRepo === r.fullName;
            const detailId = `repo-detail-${r.owner}-${r.name}`;
            return (
              <React.Fragment key={r.fullName}>
                <Box
                  as="tr"
                  tabIndex={0}
                  role="button"
                  aria-expanded={isExpanded}
                  aria-controls={detailId}
                  onClick={(e: React.MouseEvent<HTMLTableRowElement>) => {
                    if (isInteractiveTarget(e)) return;
                    onToggleExpand(r.fullName);
                  }}
                  onKeyDown={(e: React.KeyboardEvent<HTMLTableRowElement>) => {
                    if (isInteractiveTarget(e)) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onToggleExpand(r.fullName);
                    } else if (e.key === 'Escape' && isExpanded) {
                      e.preventDefault();
                      onToggleExpand(r.fullName);
                    }
                  }}
                  sx={{
                    borderBottom: '1px solid',
                    borderColor: 'border.muted',
                    '&:hover': { bg: 'canvas.subtle' },
                    '&:last-child': { borderBottom: isExpanded ? undefined : 'none' },
                    opacity: r.isActive ? 1 : 0.55,
                    cursor: 'pointer',
                    bg: isExpanded ? 'canvas.subtle' : undefined,
                    outline: 'none',
                    '&:focus-visible': { boxShadow: 'inset 0 0 0 2px var(--accent-emphasis)' },
                  }}
                >
                  <Box as="td" sx={{ p: 2, verticalAlign: 'middle' }}>
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                      <Box
                        sx={{
                          color: 'fg.muted',
                          display: 'inline-flex',
                          transition: 'transform 120ms ease',
                          transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                        }}
                        aria-hidden
                      >
                        <ChevronDownIcon size={12} />
                      </Box>
                      <Text
                        sx={{
                          display: 'inline-block',
                          minWidth: 22,
                          textAlign: 'right',
                          fontFamily: 'mono',
                          fontVariantNumeric: 'tabular-nums',
                          fontWeight: rank <= 3 ? 700 : 500,
                          fontSize: 1,
                          color: rank <= 3 ? 'attention.fg' : 'fg.muted',
                        }}
                      >
                        {rank}
                      </Text>
                    </Box>
                  </Box>
                  <Box as="td" sx={{ p: 2, verticalAlign: 'middle' }}>
                    <Link
                      href={`/repos/${r.owner}/${r.name}`}
                      prefetch={false}
                      onClick={(e) => e.stopPropagation()}
                      style={{ textDecoration: 'none' }}
                    >
                      <Box
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 2,
                          color: 'fg.default',
                          '&:hover': { color: 'accent.fg' },
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={avatarUrl(r.owner)}
                          alt={r.owner}
                          loading="lazy"
                          style={{ width: 20, height: 20, borderRadius: '50%', border: '1px solid var(--border-muted)' }}
                        />
                        <Text sx={{ fontWeight: 600 }}>{r.fullName}</Text>
                        {r.stars != null && r.stars > 0 && (
                          <Text sx={{ color: 'fg.muted', fontSize: 0, fontVariantNumeric: 'tabular-nums' }}>
                            ★ {formatCount(r.stars)}
                          </Text>
                        )}
                        {!r.isActive && (
                          <Label variant="secondary" sx={{ fontSize: '10px' }}>
                            INACTIVE
                          </Label>
                        )}
                      </Box>
                    </Link>
                  </Box>
                  <Box as="td" sx={{ p: 2, textAlign: 'right', verticalAlign: 'middle', minWidth: 90 }}>
                    <Box sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'stretch', minWidth: 70, gap: '4px' }}>
                      <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'fg.default' }}>
                        {formatWeightPct(r.weight)}
                      </Text>
                      <Box sx={{ width: '100%', height: 3, bg: 'canvas.inset', borderRadius: 999, overflow: 'hidden' }}>
                        <Box sx={{ height: '100%', bg: 'accent.emphasis' }} style={{ width: `${Math.min(100, Math.max(0, r.weight * 100))}%` }} />
                      </Box>
                    </Box>
                  </Box>
                  <Box as="td" sx={{ p: 2, textAlign: 'right', verticalAlign: 'middle' }}>
                    {taoPerDay == null ? (
                      <Text sx={{ color: 'fg.muted', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums' }}>—</Text>
                    ) : (
                      <Box>
                        <Text sx={{ display: 'block', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'fg.default' }}>
                          {formatTao(taoPerDay)}
                        </Text>
                        <Text sx={{ display: 'block', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontSize: 0, color: 'fg.muted' }}>
                          {usdPerDay != null ? formatUsd(usdPerDay) : ''}
                        </Text>
                      </Box>
                    )}
                  </Box>
                  <Box as="td" sx={{ p: 2, verticalAlign: 'middle' }}>
                    <Sparkline series={r.mergedPrSeries14d} />
                  </Box>
                  <Box as="td" sx={{ p: 2, verticalAlign: 'middle' }}>
                    <CapacityGauge
                      open={r.openPrCount}
                      threshold={r.excessivePrPenaltyThreshold}
                      maxByAuthor={r.openPrMaxByAuthor}
                      authorCount={r.openPrAuthorCount}
                    />
                  </Box>
                  <Box as="td" sx={{ p: 2, textAlign: 'right', verticalAlign: 'middle' }}>
                    <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', color: r.openIssueCount > 0 ? 'fg.default' : 'fg.muted' }}>
                      {formatCount(r.openIssueCount)}
                    </Text>
                  </Box>
                  <Box as="td" sx={{ p: 2, textAlign: 'right', verticalAlign: 'middle' }}>
                    {!r.lastPrAt ? (
                      <Text sx={{ color: 'fg.muted', fontSize: 0 }}>Never</Text>
                    ) : (
                      <Text sx={{ color: lastMergeStale ? 'danger.fg' : 'fg.default', fontSize: 0, fontVariantNumeric: 'tabular-nums' }}>
                        {formatRelativeTime(r.lastPrAt)}
                      </Text>
                    )}
                  </Box>
                  <Box as="td" sx={{ p: 2, verticalAlign: 'middle' }}>
                    <PolicyChips repo={r} />
                  </Box>
                  <Box as="td" sx={{ p: 2, textAlign: 'center', verticalAlign: 'middle' }}>
                    <Box
                      as="button"
                      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                        e.stopPropagation();
                        onToggleTrack(r.fullName);
                      }}
                      aria-label={isTracked ? 'Untrack' : 'Track'}
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
                </Box>
                {isExpanded && (
                  <Box
                    as="tr"
                    id={detailId}
                    sx={{
                      borderBottom: '1px solid',
                      borderColor: 'border.muted',
                      bg: 'canvas.inset',
                      '&:last-child': { borderBottom: 'none' },
                    }}
                  >
                    <Box as="td" colSpan={10} sx={{ p: 0 }}>
                      <ExpandedRowDetail repo={r} />
                    </Box>
                  </Box>
                )}
              </React.Fragment>
            );
          })}
          {rows.length === 0 && (
            <Box as="tr">
              <Box as="td" colSpan={10} sx={{ p: 4, textAlign: 'center', color: 'fg.muted' }}>
                No repositories match.
              </Box>
            </Box>
          )}
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
  hint,
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number;
  sortKey?: SortKey;
  current?: SortKey;
  dir?: 'asc' | 'desc';
  onSort?: (k: SortKey) => void;
  hint?: string;
}) {
  const isSortable = !!sortKey && !!onSort;
  const active = isSortable && current === sortKey;
  const cursor = isSortable ? 'pointer' : hint ? 'help' : 'default';
  const ariaSort: 'ascending' | 'descending' | 'none' | undefined = isSortable
    ? active
      ? dir === 'asc'
        ? 'ascending'
        : 'descending'
      : 'none'
    : undefined;
  const activate = isSortable && sortKey ? () => onSort!(sortKey) : undefined;
  return (
    <Box
      as="th"
      aria-sort={ariaSort}
      title={hint}
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
        userSelect: 'none',
      }}
    >
      {/* Inner button — th can't be a button, but keyboard activation needs one. */}
      <Box
        as={isSortable ? 'button' : 'span'}
        type={isSortable ? 'button' : undefined}
        onClick={activate}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
          width: '100%',
          color: 'inherit',
          bg: 'transparent',
          border: 0,
          p: 0,
          font: 'inherit',
          letterSpacing: 'inherit',
          textTransform: 'inherit',
          cursor,
          '&:hover': isSortable || hint ? { color: 'fg.default' } : undefined,
          '&:focus-visible': { outline: '2px solid var(--accent-emphasis)', outlineOffset: '2px' },
        }}
      >
        {active && (dir === 'desc' ? <TriangleDownIcon size={12} /> : <TriangleUpIcon size={12} />)}
        {children}
      </Box>
    </Box>
  );
}

function Sparkline({
  series,
  width = 80,
  height = 24,
  fluid = false,
  label = 'merged PR',
}: {
  series: number[];
  width?: number;
  height?: number;
  fluid?: boolean;
  label?: string;
}) {
  const w = width;
  const h = height;
  const max = Math.max(1, ...series);
  const barW = w / Math.max(series.length, 1);
  const gap = 1;
  const total = series.reduce((s, n) => s + n, 0);
  if (total === 0) {
    return (
      <Box sx={{ color: 'fg.muted', fontSize: 0 }} title={`No ${label}s in the last 14 days`}>
        —
      </Box>
    );
  }
  const formatted = total.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (
    <Box
      title={`${formatted} ${label}${total === 1 ? '' : 's'} in the last 14 days`}
      sx={{
        display: fluid ? 'block' : 'inline-block',
        width: fluid ? '100%' : undefined,
        lineHeight: 0,
      }}
    >
      <svg
        width={fluid ? '100%' : w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio={fluid ? 'none' : 'xMidYMid meet'}
        role="img"
        aria-label={`${label} sparkline, ${formatted} over 14 days`}
      >
        {series.map((v, i) => {
          const bh = v === 0 ? 1 : (v / max) * (h - 2);
          return (
            <rect
              key={i}
              x={i * barW + gap / 2}
              y={h - bh}
              width={Math.max(0, barW - gap)}
              height={bh}
              fill={v === 0 ? 'var(--border-muted)' : 'var(--accent-emphasis)'}
              rx={0.5}
            />
          );
        })}
      </svg>
    </Box>
  );
}

function CapacityGauge({
  open,
  threshold,
  maxByAuthor,
  authorCount,
}: {
  open: number;
  threshold: number | null;
  maxByAuthor: number;
  authorCount: number;
}) {
  if (threshold == null || threshold <= 0) {
    return (
      <Box sx={{ color: 'fg.muted', fontSize: 0 }} title="No threshold configured">
        —
      </Box>
    );
  }
  const pct = Math.min(100, (maxByAuthor / threshold) * 100);
  // Over the base threshold is red; near the base threshold is amber.
  const tone = maxByAuthor > threshold ? 'danger' : pct >= 80 ? 'attention' : 'success';
  return (
    <Box
      sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'stretch', gap: '3px', minWidth: 80 }}
      title={`Busiest author has ${maxByAuthor} open PR${maxByAuthor === 1 ? '' : 's'} vs. the base ${threshold} per-author threshold; ${open} total open PR${open === 1 ? '' : 's'} across ${authorCount} author${authorCount === 1 ? '' : 's'}. High-token miners may have a higher validator threshold.`}
    >
      <Box sx={{ width: '100%', height: 6, bg: 'canvas.inset', borderRadius: 999, overflow: 'hidden' }}>
        <Box sx={{ height: '100%', bg: `${tone}.emphasis` }} style={{ width: `${pct}%` }} />
      </Box>
      <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontSize: 0, color: `${tone}.fg` }}>
        {maxByAuthor} / {threshold}
      </Text>
    </Box>
  );
}

function PolicyChips({ repo }: { repo: GtRepo }) {
  type Chip = { label: string; title: string };
  const chips: Chip[] = [];
  if (repo.trustedLabelPipeline === true) chips.push({ label: 'trusted-label', title: 'Scoring-label pipeline is trusted' });
  if (repo.issueDiscoveryShare != null && repo.issueDiscoveryShare > 0) {
    chips.push({
      label: `discovery ${Math.round(repo.issueDiscoveryShare * 100)}%`,
      title: 'Share of emission allocated to issue discovery',
    });
  }
  if (repo.maintainerCut != null && repo.maintainerCut > 0) {
    chips.push({
      label: `maintainer ${Math.round(repo.maintainerCut * 100)}%`,
      title: 'Share of emission reserved for registered maintainers',
    });
  }
  if (repo.minCredibility != null) {
    chips.push({
      label: `min-cred ${repo.minCredibility.toFixed(1)}`,
      title: 'Minimum PR credibility required for rewards',
    });
  }
  if (chips.length === 0) {
    return (
      <Text sx={{ color: 'fg.muted', fontSize: 0 }}>—</Text>
    );
  }
  const visible = chips.slice(0, 3);
  const overflow = chips.slice(3);
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      {visible.map((c) => (
        <Chip key={c.label} label={c.label} title={c.title} />
      ))}
      {overflow.length > 0 && (
        <Chip
          label={`+${overflow.length}`}
          title={overflow.map((c) => c.label).join(', ')}
        />
      )}
    </Box>
  );
}

function Chip({ label, title }: { label: string; title: string }) {
  return (
    <Box
      title={title}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 1,
        py: '1px',
        border: '1px solid',
        borderColor: 'border.muted',
        borderRadius: 999,
        bg: 'canvas.default',
        color: 'fg.muted',
        fontSize: '10px',
        fontWeight: 600,
        letterSpacing: '0.2px',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </Box>
  );
}

function ExpandedRowDetail({ repo }: { repo: GtRepo }) {
  const { data: miners, isLoading: minersLoading, isError: minersError } = useQuery<RepoMinersResponse>({
    queryKey: ['repo-miners', repo.fullName],
    queryFn: async () => {
      const r = await fetch(`/api/gt/repos/${repo.owner}/${repo.name}/miners`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 60_000,
    refetchOnMount: false,
  });

  const { data: prsResp, isLoading: prsLoading, isError: prsError } = useQuery<GtRepoPrsResponse>({
    queryKey: ['repo-prs', repo.fullName],
    queryFn: async () => {
      const r = await fetch(`/api/gt/repos/${repo.owner}/${repo.name}/prs`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 60_000,
    refetchOnMount: false,
  });

  const topContributors = (miners?.ossContributions ?? []).slice(0, 5);
  const contributorScoreTotal = miners?.ossContributionsTotalScore ?? 0;
  const openPrs = useMemo(() => {
    const list = prsResp?.prs ?? [];
    return list
      .filter((p) => p.prState === 'OPEN')
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return Date.parse(a.prCreatedAt) - Date.parse(b.prCreatedAt);
      })
      .slice(0, 5);
  }, [prsResp]);

  const mergedPrs = useMemo(() => {
    const list = prsResp?.prs ?? [];
    return list
      .filter((p) => p.prState === 'MERGED' && p.mergedAt)
      .sort((a, b) => Date.parse(b.mergedAt!) - Date.parse(a.mergedAt!))
      .slice(0, 5);
  }, [prsResp]);

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: ['1fr', null, null, 'repeat(3, minmax(0, 1fr))'],
        gap: 3,
        p: 3,
      }}
    >
      {/* Column 1 — Top contributors */}
      <DetailColumn title="TOP CONTRIBUTORS · LAST 30D">
        {minersLoading ? (
          <DetailListSkeleton rows={5} />
        ) : minersError ? (
          <DetailErrorHint>Couldn’t load contributors.</DetailErrorHint>
        ) : topContributors.length === 0 ? (
          <EmptyHint>No contributor activity yet.</EmptyHint>
        ) : (
          topContributors.map((m) => {
            const share = contributorScoreTotal > 0 ? (m.score / contributorScoreTotal) * 100 : 0;
            return (
              <Link
                key={`${m.githubId}-${m.githubUsername}`}
                href={`https://github.com/${m.githubUsername}`}
                target="_blank"
                rel="noopener noreferrer"
                prefetch={false}
                onClick={(e) => e.stopPropagation()}
                style={{ display: 'block', textDecoration: 'none' }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    py: '6px',
                    borderTop: '1px solid',
                    borderColor: 'border.muted',
                    '&:first-of-type': { borderTop: 'none' },
                    '&:hover': { bg: 'canvas.default' },
                    mx: -2,
                    px: 2,
                    borderRadius: 1,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={m.avatarUrl}
                    alt={m.githubUsername}
                    loading="lazy"
                    style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--border-muted)' }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Text
                      sx={{
                        display: 'block',
                        color: 'fg.default',
                        fontWeight: 600,
                        fontSize: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {m.githubUsername}
                    </Text>
                    <Text sx={{ display: 'block', color: 'fg.muted', fontSize: 0 }}>
                      {m.prCount} PR{m.prCount === 1 ? '' : 's'}
                    </Text>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Text sx={{ display: 'block', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'fg.default' }}>
                      {m.score.toFixed(2)}
                    </Text>
                    <Text sx={{ display: 'block', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontSize: 0, color: 'fg.muted' }}>
                      {share >= 1 ? `${share.toFixed(0)}%` : share > 0 ? `${share.toFixed(1)}%` : '—'}
                    </Text>
                  </Box>
                </Box>
              </Link>
            );
          })
        )}
      </DetailColumn>

      {/* Column 2 — Open PRs (highest scored first) */}
      <DetailColumn title="OPEN PRS · HIGHEST SCORED">
        {prsLoading ? (
          <DetailListSkeleton rows={5} />
        ) : prsError ? (
          <DetailErrorHint>Couldn’t load open PRs.</DetailErrorHint>
        ) : openPrs.length === 0 ? (
          <EmptyHint>No open PRs right now.</EmptyHint>
        ) : (
          openPrs.map((p) => (
            <Link
              key={p.pullRequestNumber}
              href={`https://github.com/${repo.fullName}/pull/${p.pullRequestNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              prefetch={false}
              onClick={(e) => e.stopPropagation()}
              style={{ display: 'block', textDecoration: 'none' }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 2,
                  py: '6px',
                  borderTop: '1px solid',
                  borderColor: 'border.muted',
                  '&:first-of-type': { borderTop: 'none' },
                  '&:hover': { bg: 'canvas.default' },
                  mx: -2,
                  px: 2,
                  borderRadius: 1,
                }}
              >
                <Box sx={{ color: 'success.fg', display: 'inline-flex', mt: '2px', flexShrink: 0 }}>
                  <GitPullRequestIcon size={12} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Text
                    sx={{
                      display: 'block',
                      color: 'fg.default',
                      fontWeight: 500,
                      fontSize: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={p.title}
                  >
                    <Text as="span" sx={{ color: 'fg.muted', fontFamily: 'mono' }}>
                      #{p.pullRequestNumber}
                    </Text>{' '}
                    {p.title}
                  </Text>
                  <Text sx={{ display: 'block', color: 'fg.muted', fontSize: 0 }}>
                    {p.author} · {formatRelativeTime(p.prCreatedAt)}
                  </Text>
                </Box>
                {p.score > 0 && (
                  <Box
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      px: 1,
                      py: '1px',
                      border: '1px solid',
                      borderColor: 'border.muted',
                      borderRadius: 999,
                      bg: 'canvas.default',
                      fontFamily: 'mono',
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: 0,
                      fontWeight: 700,
                      color: 'fg.default',
                      flexShrink: 0,
                    }}
                  >
                    {p.score.toFixed(2)}
                  </Box>
                )}
              </Box>
            </Link>
          ))
        )}
      </DetailColumn>

      {/* Column 3 — Recently merged PRs (mirrors Open PRs, but for shipped work) */}
      <DetailColumn title="RECENTLY MERGED">
        {prsLoading ? (
          <DetailListSkeleton rows={5} />
        ) : prsError ? (
          <DetailErrorHint>Couldn’t load merged PRs.</DetailErrorHint>
        ) : mergedPrs.length === 0 ? (
          <EmptyHint>No merged PRs in this window.</EmptyHint>
        ) : (
          mergedPrs.map((p) => (
            <Link
              key={p.pullRequestNumber}
              href={`https://github.com/${repo.fullName}/pull/${p.pullRequestNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              prefetch={false}
              onClick={(e) => e.stopPropagation()}
              style={{ display: 'block', textDecoration: 'none' }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 2,
                  py: '6px',
                  borderTop: '1px solid',
                  borderColor: 'border.muted',
                  '&:first-of-type': { borderTop: 'none' },
                  '&:hover': { bg: 'canvas.default' },
                  mx: -2,
                  px: 2,
                  borderRadius: 1,
                }}
              >
                <Box sx={{ color: 'done.fg', display: 'inline-flex', mt: '2px', flexShrink: 0 }}>
                  <GitMergeIcon size={12} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Text
                    sx={{
                      display: 'block',
                      color: 'fg.default',
                      fontWeight: 500,
                      fontSize: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={p.title}
                  >
                    <Text as="span" sx={{ color: 'fg.muted', fontFamily: 'mono' }}>
                      #{p.pullRequestNumber}
                    </Text>{' '}
                    {p.title}
                  </Text>
                  <Text sx={{ display: 'block', color: 'fg.muted', fontSize: 0 }}>
                    {p.author} · merged {formatRelativeTime(p.mergedAt!)}
                  </Text>
                </Box>
                {p.score > 0 && (
                  <Box
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      px: 1,
                      py: '1px',
                      border: '1px solid',
                      borderColor: 'border.muted',
                      borderRadius: 999,
                      bg: 'canvas.default',
                      fontFamily: 'mono',
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: 0,
                      fontWeight: 700,
                      color: 'fg.default',
                      flexShrink: 0,
                    }}
                  >
                    {p.score.toFixed(2)}
                  </Box>
                )}
              </Box>
            </Link>
          ))
        )}
      </DetailColumn>
    </Box>
  );
}

function DetailColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Text
        sx={{
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.5px',
          color: 'fg.muted',
          textTransform: 'uppercase',
          mb: 2,
        }}
      >
        {title}
      </Text>
      <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

function DetailListSkeleton({ rows }: { rows: number }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 2, opacity: Math.max(0.25, 1 - i * 0.15) }}>
          <SkeletonBar width={22} height={22} rounded={999} />
          <SkeletonBar flex={1} height={10} />
          <SkeletonBar width={40} height={10} />
        </Box>
      ))}
    </Box>
  );
}
