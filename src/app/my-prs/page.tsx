'use client';

export const dynamic = 'force-dynamic';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PageLayout,
  Heading,
  Text,
  Box,
  Label,
  Link as PrimerLink,
} from '@primer/react';
import Spinner from '@/components/Spinner';
import Dropdown from '@/components/Dropdown';
import SearchInput from '@/components/SearchInput';
import { RepoIcon } from '@primer/octicons-react';
import { PullStatusBadge } from '@/components/StatusBadge';
import { SortedTable, type SortedTableColumn } from '@/components/SortedTable';
import { useListData } from '@/lib/list-data/useListData';
import { formatRelativeTime } from '@/lib/format';
import { useMinerLogin } from '@/lib/use-miner';
import type { Pull } from '@/types/entities';
import { pullStatus } from '@/types/entities';
import ContentViewer from '@/components/ContentViewer';
import { useSettings } from '@/lib/settings';

interface MyPullDto extends Pull {
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

type Filters = { state: StateFilter; list: ListFilter };

export default function MyPrsPage() {
  const { settings } = useSettings();
  const [openPull, setOpenPull] = useState<MyPullDto | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<MyPRsResp>({
    queryKey: ['my-prs'],
    queryFn: async () => {
      const r = await fetch('/api/my-prs');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30000,
  });

  const list = useListData<MyPullDto, Filters, SortKey>({
    data: data?.pulls,
    search: (p, q) =>
      `${p.title} #${p.number} ${p.repo_full_name}`.toLowerCase().includes(q),
    filters: {
      state: (p, v) => v === 'all' || pullStatus(p) === v,
      list: (p, v) =>
        v === 'all' || (v === 'whitelisted' ? p.in_whitelist : !p.in_whitelist),
    },
    initialFilters: { state: 'all', list: 'whitelisted' },
    sorts: {
      state: (a, b) => pullStatus(a).localeCompare(pullStatus(b)),
      opened: (a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''),
      updated: (a, b) => (a.updated_at ?? '').localeCompare(b.updated_at ?? ''),
      closed: (a, b) =>
        (a.merged_at ?? a.closed_at ?? '').localeCompare(
          b.merged_at ?? b.closed_at ?? '',
        ),
      repo: (a, b) => a.repo_full_name.localeCompare(b.repo_full_name),
      weight: (a, b) => (a.weight ?? 0) - (b.weight ?? 0),
    },
    initialSort: { key: 'updated', dir: 'desc' },
    defaultDirFor: (k) => (k === 'repo' ? 'asc' : 'desc'),
  });

  const handleRowClick = (pr: MyPullDto) => {
    if (settings.contentDisplay === 'modal' || settings.contentDisplay === 'side') {
      setOpenPull(pr);
    } else {
      const k = `${pr.repo_full_name}#${pr.number}`;
      setExpandedKey((prev) => (prev === k ? null : k));
    }
  };

  const me = useMinerLogin();
  const counts = useMemo(() => {
    const c = { open: 0, draft: 0, merged: 0, closed: 0 };
    if (!data?.pulls) return c;
    const lf = list.filters.list;
    for (const p of data.pulls) {
      if (lf === 'whitelisted' && !p.in_whitelist) continue;
      if (lf === 'other' && p.in_whitelist) continue;
      c[pullStatus(p)]++;
    }
    return c;
  }, [data, list.filters.list]);

  const columns = useMemo<SortedTableColumn<MyPullDto, SortKey>[]>(
    () => [
      {
        key: 'state',
        label: 'State',
        sortKey: 'state',
        skeletonWidth: 60,
        render: (pr) => <PullStatusBadge pr={pr} />,
      },
      {
        key: 'title',
        label: 'Pull Request',
        cellSx: { maxWidth: 360 },
        render: (pr) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
            <PrimerLink
              href={pr.html_url ?? '#'}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              sx={{
                fontWeight: 500,
                color: 'fg.default',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                '&:hover': { color: 'accent.fg' },
              }}
              title={pr.title}
            >
              {pr.title}
            </PrimerLink>
            <Text sx={{ color: 'fg.muted', fontSize: 0, flexShrink: 0 }}>
              #{pr.number}
            </Text>
          </Box>
        ),
      },
      {
        key: 'repo',
        label: 'Repository',
        sortKey: 'repo',
        skeletonWidth: 140,
        render: (pr) => (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
            <RepoIcon size={12} />
            <Text sx={{ fontWeight: 500, color: 'fg.default' }}>
              {pr.repo_full_name}
            </Text>
            {!pr.in_whitelist && (
              <Label variant="secondary" sx={{ ml: 1, fontSize: '10px' }}>
                not in SN74
              </Label>
            )}
          </Box>
        ),
      },
      {
        key: 'weight',
        label: 'Weight',
        sortKey: 'weight',
        align: 'right',
        skeletonWidth: 60,
        cellSx: {
          fontFamily: 'mono',
          fontVariantNumeric: 'tabular-nums',
          fontSize: 1,
        },
        render: (pr) => (
          <Text
            sx={{
              fontWeight:
                (pr.weight ?? 0) >= 0.3
                  ? 700
                  : (pr.weight ?? 0) >= 0.15
                    ? 600
                    : (pr.weight ?? 0) >= 0.05
                      ? 500
                      : 400,
              color: pr.weight ? 'fg.default' : 'fg.muted',
            }}
          >
            {pr.weight !== null ? pr.weight.toFixed(4) : '—'}
          </Text>
        ),
      },
      {
        key: 'opened',
        label: 'Opened',
        sortKey: 'opened',
        skeletonWidth: 70,
        cellSx: { fontSize: 0, color: 'fg.muted', whiteSpace: 'nowrap' },
        render: (pr) => formatRelativeTime(pr.created_at),
      },
      {
        key: 'updated',
        label: 'Updated',
        sortKey: 'updated',
        skeletonWidth: 70,
        cellSx: { fontSize: 0, color: 'fg.muted', whiteSpace: 'nowrap' },
        render: (pr) => formatRelativeTime(pr.updated_at),
      },
      {
        key: 'closed',
        label: 'Merged / Closed',
        sortKey: 'closed',
        skeletonWidth: 100,
        cellSx: { fontSize: 0, whiteSpace: 'nowrap' },
        render: (pr) =>
          pr.merged_at ? (
            <Text sx={{ color: 'success.fg' }}>
              merged {formatRelativeTime(pr.merged_at)}
            </Text>
          ) : pr.closed_at ? (
            <Text sx={{ color: 'danger.fg' }}>
              closed {formatRelativeTime(pr.closed_at)}
            </Text>
          ) : (
            <Text sx={{ color: 'fg.muted' }}>—</Text>
          ),
      },
    ],
    [],
  );

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
          <SearchInput
            value={list.query}
            onChange={list.setQuery}
            placeholder="Filter by title, repo, #…"
            width={360}
            ariaLabel="Filter pull requests"
          />
          <Dropdown
            value={list.filters.list}
            onChange={(v) => list.setFilter('list', v)}
            options={[
              { value: 'all', label: 'All repos' },
              { value: 'whitelisted', label: 'SN74 whitelist' },
              { value: 'other', label: 'Other repos' },
            ]}
            width={200}
            ariaLabel="Filter by repo list"
          />
          <Dropdown
            value={list.filters.state}
            onChange={(v) => list.setFilter('state', v)}
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
                {list.filtered.length} of {data.count} · synced {formatRelativeTime(data.last_fetch)}
              </Text>
            )}
          </Box>
        </Box>

        {isError && (
          <Box sx={{ p: 3, border: '1px solid', borderColor: 'danger.emphasis', bg: 'danger.subtle', borderRadius: 2, mb: 2 }}>
            <Text sx={{ color: 'danger.fg' }}>Failed to load your PRs.</Text>
          </Box>
        )}

        <SortedTable
          columns={columns}
          rows={list.filtered}
          rowKey={(pr) => `${pr.repo_full_name}#${pr.number}`}
          sortKey={list.sortKey}
          sortDir={list.sortDir}
          onSort={list.toggleSort}
          onRowClick={handleRowClick}
          loading={isLoading}
          empty={
            data && data.count === 0
              ? `No PRs found for ${me} yet — wait a moment for the GitHub search to populate.`
              : 'No PRs match these filters.'
          }
          isExpanded={(pr) => expandedKey === `${pr.repo_full_name}#${pr.number}`}
          renderExpanded={(pr) => {
            if (settings.contentDisplay !== 'accordion') return null;
            const [o, n] = pr.repo_full_name.split('/');
            return (
              <ContentViewer
                target={{ kind: 'pull', owner: o, name: n, number: pr.number, preloaded: pr }}
                mode="inline"
                onClose={() => setExpandedKey(null)}
              />
            );
          }}
        />
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
