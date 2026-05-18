'use client';

export const dynamic = 'force-dynamic';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PageLayout,
  Heading,
  Text,
  Box,
  TextInput,
  Label,
  Link as PrimerLink,
} from '@primer/react';
import Spinner from '@/components/Spinner';
import { TableRowsSkeleton } from '@/components/Skeleton';
import Dropdown from '@/components/Dropdown';
import { SearchIcon, RepoIcon, ClockIcon, TriangleUpIcon, TriangleDownIcon } from '@primer/octicons-react';
import { PullStatusBadge } from '@/components/StatusBadge';
import { formatRelativeTime } from '@/lib/format';
import { useMinerLogin } from '@/lib/use-miner';
import type { PullDto } from '@/lib/api-types';
import { pullStatus } from '@/lib/api-types';
import ContentViewer from '@/components/ContentViewer';
import { useSettings } from '@/lib/settings';

interface MyPullDto extends PullDto {
  in_whitelist: boolean;
  weight: number | null;
}

interface MyPRsResp {
  login: string;
  count: number;
  in_whitelist_count: number;
  last_fetch: string | null;
  pulls: MyPullDto[];
}

type StateFilter = 'all' | 'open' | 'draft' | 'merged' | 'closed';
type ListFilter = 'all' | 'whitelisted' | 'other';
type SortKey = 'state' | 'opened' | 'updated' | 'closed' | 'repo' | 'weight';
type SortDir = 'asc' | 'desc';

export default function MyPrsPage() {
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [listFilter, setListFilter] = useState<ListFilter>('whitelisted');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const { settings } = useSettings();
  const [openPull, setOpenPull] = useState<MyPullDto | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const handleRowClick = (pr: MyPullDto) => {
    if (settings.contentDisplay === 'modal' || settings.contentDisplay === 'side') {
      setOpenPull(pr);
    } else {
      const k = `${pr.repo_full_name}#${pr.number}`;
      setExpandedKey((prev) => (prev === k ? null : k));
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'repo' ? 'asc' : 'desc');
    }
  };

  const { data, isLoading, isError } = useQuery<MyPRsResp>({
    queryKey: ['my-prs'],
    queryFn: async () => {
      const r = await fetch('/api/my-prs');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30000,
  });

  const filtered = useMemo(() => {
    if (!data?.pulls) return [];
    const q = query.trim().toLowerCase();
    let list = data.pulls.filter((p) => {
      if (q && !`${p.title} #${p.number} ${p.repo_full_name}`.toLowerCase().includes(q)) return false;
      if (listFilter === 'whitelisted' && !p.in_whitelist) return false;
      if (listFilter === 'other' && p.in_whitelist) return false;
      if (stateFilter === 'all') return true;
      const s = pullStatus(p);
      return s === stateFilter;
    });
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'state') cmp = pullStatus(a).localeCompare(pullStatus(b));
      else if (sortKey === 'opened') cmp = (a.created_at ?? '').localeCompare(b.created_at ?? '');
      else if (sortKey === 'updated') cmp = (a.updated_at ?? '').localeCompare(b.updated_at ?? '');
      else if (sortKey === 'closed') cmp = (a.merged_at ?? a.closed_at ?? '').localeCompare(b.merged_at ?? b.closed_at ?? '');
      else if (sortKey === 'repo') cmp = a.repo_full_name.localeCompare(b.repo_full_name);
      else if (sortKey === 'weight') cmp = (a.weight ?? 0) - (b.weight ?? 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [data, query, stateFilter, listFilter, sortKey, sortDir]);

  const me = useMinerLogin();
  const counts = useMemo(() => {
    if (!data?.pulls) return { open: 0, draft: 0, merged: 0, closed: 0 };
    const c = { open: 0, draft: 0, merged: 0, closed: 0 };
    for (const p of data.pulls) {
      if (listFilter === 'whitelisted' && !p.in_whitelist) continue;
      if (listFilter === 'other' && p.in_whitelist) continue;
      c[pullStatus(p)]++;
    }
    return c;
  }, [data, listFilter]);

  return (
    <PageLayout containerWidth="full" padding="normal">
      <PageLayout.Header>
        <Heading sx={{ fontSize: 4, mb: 1 }}>My Pull Requests</Heading>
        <Text sx={{ color: 'fg.muted' }}>
          Every PR authored by <strong>{me}</strong> on GitHub. Whitelisted (SN74-eligible) repos are shown by default.
        </Text>
        <Box sx={{ display: 'flex', gap: 2, mt: 3, flexWrap: 'wrap' }}>
          <StatBlock label="Total" value={data?.count ?? 0} />
          <StatBlock label="In SN74 whitelist" value={data?.in_whitelist_count ?? 0} tone="success" />
          <StatBlock label="Open" value={counts.open} tone="success" />
          <StatBlock label="Merged" value={counts.merged} tone="done" />
          <StatBlock label="Draft" value={counts.draft} />
          <StatBlock label="Closed (unmerged)" value={counts.closed} tone="closed" />
        </Box>
      </PageLayout.Header>
      <PageLayout.Content>
        <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextInput
            leadingVisual={SearchIcon}
            placeholder="Filter by title, repo, #…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ width: 360, maxWidth: '100%' }}
          />
          <Dropdown
            value={listFilter}
            onChange={(v) => setListFilter(v)}
            options={[
              { value: 'all', label: 'All repos' },
              { value: 'whitelisted', label: 'SN74 whitelist' },
              { value: 'other', label: 'Other repos' },
            ]}
            width={200}
            ariaLabel="Filter by repo list"
          />
          <Dropdown
            value={stateFilter}
            onChange={(v) => setStateFilter(v)}
            options={[
              { value: 'all', label: 'All states' },
              { value: 'open', label: 'Open' },
              { value: 'draft', label: 'Draft' },
              { value: 'merged', label: 'Merged' },
              { value: 'closed', label: 'Closed (unmerged)' },
            ]}
            width={180}
            ariaLabel="Filter by state"
          />
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 2, color: 'fg.muted', fontSize: 0 }}>
            {isLoading && <Spinner size="sm" tone="muted" />}
            {data && (
              <Text>
                {filtered.length} of {data.count} · synced {formatRelativeTime(data.last_fetch)}
              </Text>
            )}
          </Box>
        </Box>

        {isError && (
          <Box sx={{ p: 3, border: '1px solid', borderColor: 'danger.emphasis', bg: 'danger.subtle', borderRadius: 2, mb: 2 }}>
            <Text sx={{ color: 'danger.fg' }}>Failed to load your PRs.</Text>
          </Box>
        )}

        <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.default', overflowX: 'auto', overflowY: 'hidden' }}>
          {filtered.length === 0 && isLoading ? (
            <TableRowsSkeleton
              rows={10}
              cols={[
                { width: 60 },
                { flex: 1 },
                { width: 140 },
                { width: 60 },
                { width: 70 },
                { width: 70 },
                { width: 100 },
              ]}
            />
          ) : filtered.length === 0 && !isLoading ? (
            <Box sx={{ p: 4, textAlign: 'center', color: 'fg.muted' }}>
              {data && data.count === 0
                ? `No PRs found for ${me} yet — wait a moment for the GitHub search to populate.`
                : 'No PRs match these filters.'}
            </Box>
          ) : (
            <Box as="table" sx={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', fontSize: 1 }}>
              <Box as="thead" sx={{ bg: 'canvas.subtle', borderBottom: '1px solid', borderColor: 'border.default' }}>
                <Box as="tr">
                  <SortHeaderTh label="State" sortKey="state" current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <Box as="th" sx={tableHeaderSx}>Pull Request</Box>
                  <SortHeaderTh label="Repository" sortKey="repo" current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortHeaderTh label="Weight" sortKey="weight" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                  <SortHeaderTh label="Opened" sortKey="opened" current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortHeaderTh label="Updated" sortKey="updated" current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortHeaderTh label="Merged / Closed" sortKey="closed" current={sortKey} dir={sortDir} onClick={toggleSort} />
                </Box>
              </Box>
              <Box as="tbody">
                {filtered.map((pr) => {
                  const k = `${pr.repo_full_name}#${pr.number}`;
                  const expanded = expandedKey === k;
                  const [o, n] = pr.repo_full_name.split('/');
                  return (
                    <React.Fragment key={k}>
                      <MyPRTableRow
                        pr={pr}
                        onRowClick={() => handleRowClick(pr)}
                        expanded={expanded}
                      />
                      {expanded && settings.contentDisplay === 'accordion' && (
                        <Box as="tr">
                          <Box as="td" colSpan={7} sx={{ p: 0 }}>
                            <ContentViewer
                              target={{ kind: 'pull', owner: o, name: n, number: pr.number, preloaded: pr }}
                              mode="inline"
                              onClose={() => setExpandedKey(null)}
                            />
                          </Box>
                        </Box>
                      )}
                    </React.Fragment>
                  );
                })}
              </Box>
            </Box>
          )}
        </Box>
      </PageLayout.Content>

      {openPull && settings.contentDisplay === 'modal' && (() => {
        const [o, n] = openPull.repo_full_name.split('/');
        return (
          <ContentViewer
            target={{ kind: 'pull', owner: o, name: n, number: openPull.number, preloaded: openPull }}
            mode="modal"
            onClose={() => setOpenPull(null)}
          />
        );
      })()}

      {openPull && settings.contentDisplay === 'side' && (() => {
        const [o, n] = openPull.repo_full_name.split('/');
        return (
          <Box
            sx={{
              position: 'fixed',
              top: 'var(--header-height)',
              right: 0,
              bottom: 0,
              width: 480,
              maxWidth: '50vw',
              borderLeft: '1px solid',
              borderColor: 'var(--border-default)',
              bg: 'var(--bg-canvas)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              zIndex: 90,
            }}
          >
            <ContentViewer
              target={{ kind: 'pull', owner: o, name: n, number: openPull.number, preloaded: openPull }}
              mode="side"
              onClose={() => setOpenPull(null)}
            />
          </Box>
        );
      })()}
    </PageLayout>
  );
}

const tableHeaderSx = {
  px: 3,
  py: 2,
  textAlign: 'left' as const,
  fontWeight: 600,
  fontSize: '11px',
  color: 'fg.muted',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  whiteSpace: 'nowrap' as const,
};

function SortHeaderTh({
  label,
  sortKey,
  current,
  dir,
  onClick,
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  align?: 'left' | 'right' | 'center';
}) {
  const active = current === sortKey;
  return (
    <Box
      as="th"
      onClick={() => onClick(sortKey)}
      sx={{ ...tableHeaderSx, textAlign: align, cursor: 'pointer', userSelect: 'none', '&:hover': { color: 'fg.default' } }}
    >
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        {label}
        {active && (dir === 'asc' ? <TriangleUpIcon size={12} /> : <TriangleDownIcon size={12} />)}
      </Box>
    </Box>
  );
}

function MyPRTableRow({
  pr,
  onRowClick,
  expanded,
}: {
  pr: MyPullDto;
  onRowClick?: () => void;
  expanded?: boolean;
}) {
  return (
    <Box
      as="tr"
      onClick={onRowClick}
      data-explorer-row="true"
      sx={{
        borderBottom: '1px solid',
        borderColor: 'border.muted',
        bg: expanded ? 'accent.muted' : 'canvas.default',
        cursor: 'pointer',
        '&:hover': { bg: 'canvas.subtle' },
      }}
    >
      <Box as="td" sx={{ p: 2, verticalAlign: 'middle' }}>
        <PullStatusBadge pr={pr} />
      </Box>
      <Box as="td" sx={{ p: 2, maxWidth: 360, verticalAlign: 'middle' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          <PrimerLink
            href={pr.html_url ?? '#'}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            sx={{ fontWeight: 500, color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', '&:hover': { color: 'accent.fg' } }}
            title={pr.title}
          >
            {pr.title}
          </PrimerLink>
          <Text sx={{ color: 'fg.muted', fontSize: 0, flexShrink: 0 }}>#{pr.number}</Text>
        </Box>
      </Box>
      <Box as="td" sx={{ p: 2, verticalAlign: 'middle' }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
          <RepoIcon size={12} />
          <Text sx={{ fontWeight: 500, color: 'fg.default' }}>{pr.repo_full_name}</Text>
          {!pr.in_whitelist && (
            <Label variant="secondary" sx={{ ml: 1, fontSize: '10px' }}>
              not in SN74
            </Label>
          )}
        </Box>
      </Box>
      <Box
        as="td"
        sx={{
          p: 2,
          textAlign: 'right',
          fontFamily: 'mono',
          fontVariantNumeric: 'tabular-nums',
          fontSize: 1,
          fontWeight: (pr.weight ?? 0) >= 0.3 ? 700 : (pr.weight ?? 0) >= 0.15 ? 600 : (pr.weight ?? 0) >= 0.05 ? 500 : 400,
          color: pr.weight ? 'fg.default' : 'fg.muted',
          verticalAlign: 'middle',
        }}
      >
        {pr.weight !== null ? pr.weight.toFixed(4) : '—'}
      </Box>
      <Box as="td" sx={{ p: 2, fontSize: 0, color: 'fg.muted', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
        {formatRelativeTime(pr.created_at)}
      </Box>
      <Box as="td" sx={{ p: 2, fontSize: 0, color: 'fg.muted', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
        {formatRelativeTime(pr.updated_at)}
      </Box>
      <Box as="td" sx={{ p: 2, fontSize: 0, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
        {pr.merged_at ? (
          <Text sx={{ color: 'success.fg' }}>merged {formatRelativeTime(pr.merged_at)}</Text>
        ) : pr.closed_at ? (
          <Text sx={{ color: 'danger.fg' }}>closed {formatRelativeTime(pr.closed_at)}</Text>
        ) : (
          <Text sx={{ color: 'fg.muted' }}>—</Text>
        )}
      </Box>
    </Box>
  );
}

function MyPRRow({ pr, isLast }: { pr: MyPullDto; isLast: boolean }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 3,
        p: 3,
        borderBottom: isLast ? 'none' : '1px solid',
        borderColor: 'border.muted',
        bg: 'canvas.default',
        '&:hover': { bg: 'canvas.subtle' },
      }}
    >
      <Box sx={{ pt: '2px' }}>
        <PullStatusBadge pr={pr} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap' }}>
          <PrimerLink
            href={pr.html_url ?? '#'}
            target="_blank"
            rel="noreferrer"
            sx={{ fontWeight: 600, color: 'fg.default', '&:hover': { color: 'accent.fg' } }}
          >
            {pr.title}
          </PrimerLink>
          <Text sx={{ color: 'fg.muted', fontSize: 0 }}>#{pr.number}</Text>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'fg.muted', fontSize: 0, mt: 1, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
            <RepoIcon size={12} />
            <Text sx={{ fontWeight: 500, color: 'fg.default' }}>{pr.repo_full_name}</Text>
            {pr.in_whitelist && pr.weight !== null && (
              <Label variant="secondary" sx={{ ml: 1, fontSize: '10px' }}>
                w={pr.weight.toFixed(4)}
              </Label>
            )}
            {!pr.in_whitelist && (
              <Label variant="secondary" sx={{ ml: 1, fontSize: '10px' }}>
                not in SN74
              </Label>
            )}
            {pr.author_association && pr.author_association !== 'NONE' && (
              <Label variant="secondary" sx={{ ml: 1, fontSize: '10px' }}>
                {pr.author_association.toLowerCase()}
              </Label>
            )}
          </Box>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
            <ClockIcon size={12} />
            opened {formatRelativeTime(pr.created_at)}
          </Box>
          {pr.merged_at && <Text>· merged {formatRelativeTime(pr.merged_at)}</Text>}
          {!pr.merged_at && pr.closed_at && <Text>· closed {formatRelativeTime(pr.closed_at)}</Text>}
        </Box>
      </Box>
    </Box>
  );
}

function StatBlock({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'success' | 'accent' | 'done' | 'closed';
}) {
  const colors: Record<string, string> = {
    neutral: 'fg.default',
    success: 'success.fg',
    accent: 'accent.fg',
    done: 'done.fg',
    closed: 'closed.fg',
  };
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
        px: 3,
        py: 2,
        minWidth: 140,
      }}
    >
      <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block' }}>{label}</Text>
      <Text sx={{ fontSize: 3, fontWeight: 'bold', color: colors[tone] }}>{value}</Text>
    </Box>
  );
}
