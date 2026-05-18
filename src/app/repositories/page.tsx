'use client';

export const dynamic = 'force-dynamic';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
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
  ChevronLeftIcon,
  ChevronRightIcon,
  GitPullRequestIcon,
  GitMergeIcon,
  ArrowDownIcon,
  ArrowUpIcon,
} from '@primer/octicons-react';
import { TableRowsSkeleton, CardGridSkeleton } from '@/components/Skeleton';
import { useTrackedRepos } from '@/lib/tracked-repos';
import { formatRelativeTime } from '@/lib/format';

interface GtRepo {
  fullName: string;
  owner: string;
  name: string;
  weight: number;
  isActive: boolean;
  inactiveAt: string | null;
  totalScore: number;
  totalPrCount: number;
  mergedPrCount: number;
  contributorCount: number;
  collateralStaked: number;
  prsThisWeek: number;
  prsLastWeek: number;
  trendingPct: number;
  lastPrAt: string | null;
}

interface GtPrSummary {
  pullRequestNumber: number;
  title: string;
  repository: string;
  author: string;
  prCreatedAt: string;
  prState: string;
  mergedAt: string | null;
}

interface GtReposResp {
  fetched_at: number;
  source?: string;
  count: number;
  activeCount: number;
  inactiveCount: number;
  repos: GtRepo[];
  recentPrs: GtPrSummary[];
}

type SortKey = 'weight' | 'totalScore' | 'mergedPrCount' | 'contributorCount' | 'fullName';
type StatusFilter = 'all' | 'active' | 'inactive';
type ViewMode = 'list' | 'grid';

const PAGE_SIZES = [10, 12, 25, 50, 100];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'weight', label: 'Weight' },
  { key: 'totalScore', label: 'Total Score' },
  { key: 'mergedPrCount', label: 'PRs' },
  { key: 'contributorCount', label: 'Contributors' },
  { key: 'fullName', label: 'Repository' },
];

function fmtNum(n: number, digits = 2): string {
  if (n === 0) return '-';
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  return n.toFixed(digits);
}

function fmtCount(n: number): string {
  if (!n) return '-';
  return n.toLocaleString();
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0%';
  const sign = n > 0 ? '+' : '';
  if (Math.abs(n) >= 100) return `${sign}${n.toFixed(0)}%`;
  return `${sign}${n.toFixed(0)}%`;
}

function avatarUrl(owner: string): string {
  return `https://github.com/${owner}.png?size=48`;
}

export default function RepositoriesPage() {
  const { tracked, toggle } = useTrackedRepos();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('weight');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [view, setView] = useState<ViewMode>('list');
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState<number>(1);

  const { data, isLoading, isError } = useQuery<GtReposResp>({
    queryKey: ['gt-repositories'],
    queryFn: async () => {
      const r = await fetch('/api/gt/repositories');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  const onSortChange = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
    setPage(1);
  };

  const filtered = useMemo(() => {
    if (!data?.repos) return [] as GtRepo[];
    const q = query.trim().toLowerCase();
    let list = data.repos.filter((r) => {
      if (status === 'active' && !r.isActive) return false;
      if (status === 'inactive' && r.isActive) return false;
      if (q && !r.fullName.toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'weight') cmp = a.weight - b.weight;
      else if (sortKey === 'totalScore') cmp = a.totalScore - b.totalScore;
      else if (sortKey === 'mergedPrCount') cmp = a.mergedPrCount - b.mergedPrCount;
      else if (sortKey === 'contributorCount') cmp = a.contributorCount - b.contributorCount;
      else if (sortKey === 'fullName') cmp = a.fullName.localeCompare(b.fullName);
      if (cmp === 0) cmp = sortKey === 'fullName' ? 0 : a.weight - b.weight;
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return list;
  }, [data, query, status, sortKey, sortDir]);

  const trending = useMemo(() => {
    if (!data?.repos) return [] as GtRepo[];
    return [...data.repos]
      .filter((r) => r.trendingPct > 0)
      .sort((a, b) => b.trendingPct - a.trendingPct)
      .slice(0, 5);
  }, [data]);

  const topCollateral = useMemo(() => {
    if (!data?.repos) return [] as GtRepo[];
    return [...data.repos]
      .filter((r) => r.collateralStaked > 0)
      .sort((a, b) => b.collateralStaked - a.collateralStaked)
      .slice(0, 5);
  }, [data]);

  const recentPrs = data?.recentPrs?.slice(0, 5) ?? [];

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageItems = filtered.slice(pageStart, pageStart + pageSize);

  return (
    <PageLayout containerWidth="xlarge" padding="normal">
      <PageLayout.Header>
        <Heading sx={{ fontSize: 4, mb: 1 }}>Repositories</Heading>
        <Text sx={{ color: 'fg.muted' }}>
          SN74 tracked repositories — weight, scoring, and contributor activity.
        </Text>
      </PageLayout.Header>
      <PageLayout.Content>
        {/* Top three info cards */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: ['1fr', null, null, 'repeat(3, minmax(0, 1fr))'],
            gap: 3,
            mb: 3,
          }}
        >
          <InfoCard title="TRENDING THIS WEEK">
            {trending.length === 0 ? (
              <EmptyHint>No PR activity in the last 7 days.</EmptyHint>
            ) : (
              trending.map((r) => (
                <CardRow key={r.fullName} repo={r} right={<PctBadge pct={r.trendingPct} />} />
              ))
            )}
          </InfoCard>

          <InfoCard title="MOST COLLATERAL STAKED">
            {topCollateral.length === 0 ? (
              <EmptyHint>No collateral data yet.</EmptyHint>
            ) : (
              topCollateral.map((r) => (
                <CardRow
                  key={r.fullName}
                  repo={r}
                  right={
                    <Box sx={{ textAlign: 'right' }}>
                      <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                        {r.collateralStaked.toFixed(1)}
                      </Text>
                      <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>({r.totalPrCount} PRs)</Text>
                    </Box>
                  }
                />
              ))
            )}
          </InfoCard>

          <InfoCard title="RECENT PULL REQUESTS">
            {recentPrs.length === 0 ? (
              <EmptyHint>No recent PRs.</EmptyHint>
            ) : (
              recentPrs.map((p) => <RecentPrRow key={`${p.repository}#${p.pullRequestNumber}`} pr={p} />)
            )}
          </InfoCard>
        </Box>

        {/* Toolbar */}
        <Box
          sx={{
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 2,
            bg: 'canvas.subtle',
            p: 3,
            mb: 0,
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            borderBottom: 'none',
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: ['column', null, 'row'], alignItems: ['stretch', null, 'center'], gap: 3, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, maxWidth: '100%', overflowX: 'auto', pb: ['2px', null, 0] }}>
              <StatusTab active={status === 'all'} onClick={() => { setStatus('all'); setPage(1); }} label="All" count={data?.count} />
              <StatusTab active={status === 'active'} onClick={() => { setStatus('active'); setPage(1); }} label="Active" count={data?.activeCount} />
              <StatusTab active={status === 'inactive'} onClick={() => { setStatus('inactive'); setPage(1); }} label="Inactive" count={data?.inactiveCount} />
            </Box>

            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'fg.muted', fontSize: 1 }}>
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

            <Box sx={{ flex: 1, minWidth: [0, null, 240], width: ['100%', null, 'auto'] }}>
              <TextInput
                leadingVisual={SearchIcon}
                placeholder="Search or enter owner/name…"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1); }}
                sx={{ width: '100%' }}
              />
            </Box>

            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
              <ViewToggleBtn active={view === 'list'} onClick={() => setView('list')} aria="List view">
                <ListUnorderedIcon size={14} />
              </ViewToggleBtn>
              <ViewToggleBtn active={view === 'grid'} onClick={() => setView('grid')} aria="Grid view">
                <TableIcon size={14} />
              </ViewToggleBtn>
            </Box>
          </Box>

          {/* Card layouts have no sortable table headers, so expose sort controls there. */}
          {(view === 'grid' || view === 'list') && (
            <Box
              sx={{
                display: view === 'grid' ? 'flex' : ['flex', null, null, 'none'],
                flexDirection: ['column', null, 'row'],
                alignItems: ['stretch', null, 'center'],
                justifyContent: 'flex-end',
                gap: 2,
                mt: 3,
                color: 'fg.muted',
                fontSize: 1,
              }}
            >
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
                  px: 2,
                  py: '4px',
                  fontSize: 1,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  minWidth: [0, null, 140],
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
                  width: ['100%', null, 28],
                  height: 28,
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
          )}
        </Box>

        {isError && (
          <Box sx={{ p: 3, border: '1px solid', borderColor: 'danger.emphasis', bg: 'danger.subtle', borderRadius: 2, mb: 2 }}>
            <Text sx={{ color: 'danger.fg' }}>Failed to load repositories.</Text>
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

        {data && view === 'list' && (
          <>
            <Box sx={{ display: ['block', null, null, 'none'] }}>
              <RepoCards
                rows={pageItems}
                startRank={pageStart + 1}
                tracked={tracked}
                onToggleTrack={toggle}
              />
            </Box>
            <Box sx={{ display: ['none', null, null, 'block'] }}>
              <RepoTable
                rows={pageItems}
                startRank={pageStart + 1}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSortChange}
                tracked={tracked}
                onToggleTrack={toggle}
              />
            </Box>
          </>
        )}

        {data && view === 'grid' && (
          <RepoCards
            rows={pageItems}
            startRank={pageStart + 1}
            tracked={tracked}
            onToggleTrack={toggle}
          />
        )}

        {data && (
          <Box
            sx={{
              border: '1px solid',
              borderColor: 'border.default',
              borderTop: 'none',
              borderBottomLeftRadius: 2,
              borderBottomRightRadius: 2,
              bg: 'canvas.subtle',
              px: 3,
              py: 2,
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
      </PageLayout.Content>
    </PageLayout>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
        p: 3,
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
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

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ py: 3, textAlign: 'center', color: 'fg.muted', fontSize: 1 }}>{children}</Box>
  );
}

function CardRow({ repo, right }: { repo: GtRepo; right: React.ReactNode }) {
  return (
    <Link href={`/repos/${repo.owner}/${repo.name}`} prefetch={false} style={{ display: 'block', minWidth: 0, textDecoration: 'none' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          minWidth: 0,
          py: '8px',
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
          src={avatarUrl(repo.owner)}
          alt={repo.owner}
          loading="lazy"
          style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--border-muted)', flexShrink: 0 }}
        />
        <Text
          sx={{
            flex: 1,
            minWidth: 0,
            color: 'fg.default',
            fontWeight: 500,
            fontSize: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {repo.fullName}
        </Text>
        <Box sx={{ flexShrink: 0 }}>{right}</Box>
      </Box>
    </Link>
  );
}

function PctBadge({ pct }: { pct: number }) {
  const positive = pct >= 0;
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 2,
        py: '2px',
        bg: positive ? 'success.subtle' : 'danger.subtle',
        color: positive ? 'success.fg' : 'danger.fg',
        border: '1px solid',
        borderColor: positive ? 'success.muted' : 'danger.muted',
        borderRadius: 999,
        fontFamily: 'mono',
        fontVariantNumeric: 'tabular-nums',
        fontSize: 0,
        fontWeight: 700,
      }}
    >
      {fmtPct(pct)}
    </Box>
  );
}

function RecentPrRow({ pr }: { pr: GtPrSummary }) {
  const merged = !!pr.mergedAt;
  const Icon = merged ? GitMergeIcon : GitPullRequestIcon;
  const color = merged ? 'done.fg' : pr.prState === 'CLOSED' ? 'danger.fg' : 'success.fg';
  return (
    <Link
      href={`https://github.com/${pr.repository}/pull/${pr.pullRequestNumber}`}
      target="_blank"
      prefetch={false}
      style={{ display: 'block', minWidth: 0, textDecoration: 'none' }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 2,
          minWidth: 0,
          py: '8px',
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
          src={avatarUrl(pr.repository.split('/')[0] ?? '')}
          alt={pr.repository}
          loading="lazy"
          style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--border-muted)', flexShrink: 0, marginTop: 2 }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Text sx={{ display: 'block', color: 'fg.muted', fontSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pr.repository}
          </Text>
          <Box sx={{ display: 'flex', alignItems: ['flex-start', null, 'center'], gap: 1, minWidth: 0, mt: '2px' }}>
            <Box sx={{ color, flexShrink: 0, display: 'inline-flex' }}>
              <Icon size={12} />
            </Box>
            <Text
              sx={{
                color: 'fg.default',
                fontWeight: 500,
                fontSize: 1,
                overflow: 'hidden',
                textOverflow: ['clip', null, 'ellipsis'],
                whiteSpace: ['normal', null, 'nowrap'],
                overflowWrap: 'anywhere',
                lineHeight: 1.35,
                flex: 1,
              }}
              title={pr.title}
            >
              {pr.title}
            </Text>
          </Box>
          <Text sx={{ display: ['block', null, 'none'], color: 'fg.muted', fontSize: 0, mt: 1 }}>
            {formatRelativeTime(pr.prCreatedAt)}
          </Text>
        </Box>
        <Text sx={{ display: ['none', null, 'block'], color: 'fg.muted', fontSize: 0, flexShrink: 0 }}>
          {formatRelativeTime(pr.prCreatedAt)}
        </Text>
      </Box>
    </Link>
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

function ViewToggleBtn({
  active,
  onClick,
  aria,
  children,
}: {
  active: boolean;
  onClick: () => void;
  aria: string;
  children: React.ReactNode;
}) {
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
        borderColor: active ? 'border.default' : 'transparent',
        borderRadius: 1,
        bg: active ? 'canvas.default' : 'transparent',
        color: active ? 'fg.default' : 'fg.muted',
        cursor: 'pointer',
      }}
    >
      {children}
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

function RepoTable({
  rows,
  startRank,
  sortKey,
  sortDir,
  onSort,
  tracked,
  onToggleTrack,
}: {
  rows: GtRepo[];
  startRank: number;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
  tracked: Set<string>;
  onToggleTrack: (fullName: string) => void;
}) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderTop: 'none',
        bg: 'canvas.subtle',
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      <Box as="table" sx={{ width: '100%', minWidth: 980, borderCollapse: 'collapse', fontSize: 1 }}>
        <Box as="thead" sx={{ borderBottom: '1px solid', borderColor: 'border.default' }}>
          <Box as="tr">
            <Th width={70}>RANK</Th>
            <Th>REPOSITORY</Th>
            <Th align="right" sortKey="weight" current={sortKey} dir={sortDir} onSort={onSort}>WEIGHT</Th>
            <Th align="right" sortKey="totalScore" current={sortKey} dir={sortDir} onSort={onSort}>TOTAL SCORE</Th>
            <Th align="right" sortKey="mergedPrCount" current={sortKey} dir={sortDir} onSort={onSort}>PRS</Th>
            <Th align="right" sortKey="contributorCount" current={sortKey} dir={sortDir} onSort={onSort}>CONTRIBUTORS</Th>
            <Th align="center" width={36}>★</Th>
          </Box>
        </Box>
        <Box as="tbody">
          {rows.map((r, i) => {
            const rank = startRank + i;
            const isTracked = tracked.has(r.fullName);
            return (
              <Box
                as="tr"
                key={r.fullName}
                sx={{
                  borderBottom: '1px solid',
                  borderColor: 'border.muted',
                  '&:hover': { bg: 'canvas.default' },
                  '&:last-child': { borderBottom: 'none' },
                  opacity: r.isActive ? 1 : 0.55,
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
                  <Link href={`/repos/${r.owner}/${r.name}`} prefetch={false} style={{ textDecoration: 'none' }}>
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
                      {!r.isActive && (
                        <Label variant="secondary" sx={{ fontSize: '10px' }}>
                          INACTIVE
                        </Label>
                      )}
                    </Box>
                  </Link>
                </Box>
                <Box as="td" sx={{ p: 2, textAlign: 'right', verticalAlign: 'middle' }}>
                  <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'fg.default' }}>
                    {r.weight.toFixed(2)}
                  </Text>
                </Box>
                <Box as="td" sx={{ p: 2, textAlign: 'right', verticalAlign: 'middle' }}>
                  <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', color: r.totalScore > 0 ? 'fg.default' : 'fg.muted' }}>
                    {fmtNum(r.totalScore)}
                  </Text>
                </Box>
                <Box as="td" sx={{ p: 2, textAlign: 'right', verticalAlign: 'middle' }}>
                  <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', color: r.mergedPrCount > 0 ? 'fg.default' : 'fg.muted' }}>
                    {fmtCount(r.mergedPrCount)}
                  </Text>
                </Box>
                <Box as="td" sx={{ p: 2, textAlign: 'right', verticalAlign: 'middle' }}>
                  <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', color: r.contributorCount > 0 ? 'fg.default' : 'fg.muted' }}>
                    {fmtCount(r.contributorCount)}
                  </Text>
                </Box>
                <Box as="td" sx={{ p: 2, textAlign: 'center', verticalAlign: 'middle' }}>
                  <Box
                    as="button"
                    onClick={() => onToggleTrack(r.fullName)}
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
            );
          })}
          {rows.length === 0 && (
            <Box as="tr">
              <Box as="td" colSpan={7} sx={{ p: 4, textAlign: 'center', color: 'fg.muted' }}>
                No repositories match.
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function RepoCards({
  rows,
  startRank,
  tracked,
  onToggleTrack,
}: {
  rows: GtRepo[];
  startRank: number;
  tracked: Set<string>;
  onToggleTrack: (fullName: string) => void;
}) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderTop: 'none',
        borderBottomLeftRadius: 2,
        borderBottomRightRadius: 2,
        bg: 'canvas.subtle',
        p: [2, null, 3],
      }}
    >
      {rows.length === 0 ? (
        <Box sx={{ p: 4, textAlign: 'center', color: 'fg.muted' }}>
          No repositories match.
        </Box>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))',
            gap: 3,
          }}
        >
          {rows.map((r, i) => (
            <RepoGridCard
              key={r.fullName}
              repo={r}
              rank={startRank + i}
              isTracked={tracked.has(r.fullName)}
              onToggleTrack={() => onToggleTrack(r.fullName)}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

function RepoGridCard({
  repo,
  rank,
  isTracked,
  onToggleTrack,
}: {
  repo: GtRepo;
  rank: number;
  isTracked: boolean;
  onToggleTrack: () => void;
}) {
  // Weight bar fills proportionally to the max possible weight (1.0).
  const weightPct = Math.min(100, Math.max(0, repo.weight * 100));
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.default',
        p: 3,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box
          sx={{
            minWidth: 26,
            height: 22,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            px: 1,
            border: '1px solid',
            borderColor: rank <= 3 ? 'var(--attention-emphasis)' : 'border.default',
            borderRadius: 1,
            fontFamily: 'mono',
            fontWeight: 700,
            fontSize: '11px',
            color: rank <= 3 ? 'var(--attention-emphasis)' : 'fg.default',
          }}
        >
          {rank}
        </Box>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl(repo.owner)}
          alt={repo.owner}
          loading="lazy"
          style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--border-muted)' }}
        />
        <Link href={`/repos/${repo.owner}/${repo.name}`} prefetch={false} style={{ textDecoration: 'none', flex: 1, minWidth: 0 }}>
          <Text
            sx={{
              fontWeight: 600,
              color: 'fg.default',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'block',
              '&:hover': { color: 'accent.fg' },
            }}
            title={repo.fullName}
          >
            {repo.fullName}
          </Text>
        </Link>
        <StatusChip active={repo.isActive} />
        <Box
          as="button"
          onClick={onToggleTrack}
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
            '&:hover': { color: 'attention.fg' },
          }}
        >
          {isTracked ? <StarFillIcon size={14} /> : <StarIcon size={14} />}
        </Box>
      </Box>

      {/* WEIGHT row — label left, value right, then full-width bar */}
      <Box sx={{ mt: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '6px' }}>
          <Text sx={{ fontSize: '10px', color: 'fg.muted', fontWeight: 600, letterSpacing: '0.5px' }}>WEIGHT</Text>
          <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'fg.default' }}>
            {repo.weight.toFixed(2)}
          </Text>
        </Box>
        <Box sx={{ width: '100%', height: 4, bg: 'canvas.inset', borderRadius: 999, overflow: 'hidden' }}>
          <Box sx={{ height: '100%', bg: 'accent.emphasis' }} style={{ width: `${weightPct}%` }} />
        </Box>
      </Box>

      {/* 3-col stats row: TOTAL SCORE / PRS / CONTRIBUTORS */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr 1.2fr',
          gap: 1,
          pt: 2,
          borderTop: '1px solid',
          borderColor: 'border.muted',
        }}
      >
        <GridStat label="TOTAL SCORE" value={fmtNum(repo.totalScore)} muted={repo.totalScore === 0} />
        <GridStat label="PRS" value={fmtCount(repo.mergedPrCount)} muted={repo.mergedPrCount === 0} />
        <GridStat label="CONTRIBUTORS" value={fmtCount(repo.contributorCount)} muted={repo.contributorCount === 0} />
      </Box>
    </Box>
  );
}

function GridStat({ label, value, muted }: { label: string; value: string; muted: boolean }) {
  return (
    <Box>
      <Text sx={{ display: 'block', fontSize: '10px', letterSpacing: '0.5px', color: 'fg.muted', fontWeight: 600, mb: '2px' }}>
        {label}
      </Text>
      <Text
        sx={{
          fontFamily: 'mono',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 700,
          color: muted ? 'fg.muted' : 'fg.default',
          fontSize: 2,
        }}
      >
        {value}
      </Text>
    </Box>
  );
}

function StatusChip({ active }: { active: boolean }) {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 2,
        py: '2px',
        borderRadius: 1,
        bg: active ? 'success.subtle' : 'neutral.subtle',
        color: active ? 'success.fg' : 'fg.muted',
        border: '1px solid',
        borderColor: active ? 'success.muted' : 'border.default',
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.5px',
        flexShrink: 0,
      }}
    >
      {active ? 'ACTIVE' : 'INACTIVE'}
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
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
        }}
      >
        {active && (dir === 'desc' ? <TriangleDownIcon size={12} /> : <TriangleUpIcon size={12} />)}
        {children}
      </Box>
    </Box>
  );
}
