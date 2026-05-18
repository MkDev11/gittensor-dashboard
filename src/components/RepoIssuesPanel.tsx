'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Text, TextInput, Label, Link as PrimerLink } from '@primer/react';
import Spinner from '@/components/Spinner';
import { TableRowsSkeleton } from '@/components/Skeleton';
import Dropdown from '@/components/Dropdown';
import { IssueLabels } from '@/components/IssueLabels';
import { SearchIcon, CommentIcon, ClockIcon } from '@primer/octicons-react';
import type { IssueDto, IssuesResponse } from '@/lib/api-types';
import { IssueStatusBadge } from '@/components/StatusBadge';
import { formatRelativeTime } from '@/lib/format';

type StateFilter = 'all' | 'open' | 'completed' | 'not_planned' | 'closed_other';

const FILTER_OPTS: { id: StateFilter; label: string }[] = [
  { id: 'all', label: 'All states' },
  { id: 'open', label: 'Open' },
  { id: 'completed', label: 'Completed' },
  { id: 'not_planned', label: 'Not planned' },
  { id: 'closed_other', label: 'Closed (other)' },
];

export default function RepoIssuesPanel({ owner, name }: { owner: string; name: string }) {
  const [filter, setFilter] = useState<StateFilter>('all');
  const [query, setQuery] = useState('');

  const { data, isLoading, isError, dataUpdatedAt } = useQuery<IssuesResponse>({
    queryKey: ['issues', owner, name],
    queryFn: async () => {
      const r = await fetch(`/api/repos/${owner}/${name}/issues`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 15000,
  });

  const filtered = useMemo(() => {
    if (!data?.issues) return [];
    const q = query.trim().toLowerCase();
    return data.issues.filter((i) => {
      if (q && !`${i.title} #${i.number} ${i.author_login ?? ''}`.toLowerCase().includes(q)) return false;
      if (filter === 'all') return true;
      if (filter === 'open') return i.state === 'open';
      if (filter === 'completed') return i.state === 'closed' && (i.state_reason === 'COMPLETED' || i.state_reason === 'completed');
      if (filter === 'not_planned') return i.state === 'closed' && (i.state_reason === 'NOT_PLANNED' || i.state_reason === 'not_planned');
      if (filter === 'closed_other')
        return i.state === 'closed' && i.state_reason !== 'COMPLETED' && i.state_reason !== 'completed' && i.state_reason !== 'NOT_PLANNED' && i.state_reason !== 'not_planned';
      return true;
    });
  }, [data, query, filter]);

  const lastFetch = data?.last_fetch;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <TextInput
          leadingVisual={SearchIcon}
          placeholder="Filter issues by title, #, author…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ width: 360, maxWidth: '100%' }}
        />
        <Dropdown
          value={filter}
          onChange={(v) => setFilter(v)}
          options={FILTER_OPTS.map((o) => ({ value: o.id, label: o.label }))}
          width={180}
          ariaLabel="Filter by state"
        />
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 2, color: 'fg.muted', fontSize: 0 }}>
          {isLoading && <Spinner size="sm" tone="muted" />}
          {data && (
            <Text>
              {filtered.length} of {data.count} · synced {formatRelativeTime(lastFetch)}
            </Text>
          )}
        </Box>
      </Box>

      {isError && (
        <Box sx={{ p: 3, border: '1px solid', borderColor: 'danger.emphasis', borderRadius: 2, bg: 'danger.subtle', mb: 2 }}>
          <Text sx={{ color: 'danger.fg' }}>Failed to load issues. Check the dev server logs.</Text>
        </Box>
      )}

      <Box
        sx={{
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 2,
          bg: 'canvas.default',
          overflow: 'hidden',
        }}
      >
        {filtered.length === 0 && isLoading ? (
          <TableRowsSkeleton
            rows={8}
            cols={[{ width: 60 }, { flex: 1 }, { width: 80 }, { width: 60 }]}
            rowHeight={48}
          />
        ) : filtered.length === 0 && !isLoading ? (
          <Box sx={{ p: 4, textAlign: 'center', color: 'fg.muted' }}>No issues match these filters.</Box>
        ) : null}
        {filtered.map((issue, idx) => (
          <IssueRow
            key={issue.id}
            issue={issue}
            isLast={idx === filtered.length - 1}
          />
        ))}
      </Box>
    </Box>
  );
}

function IssueRow({ issue, isLast }: { issue: IssueDto; isLast: boolean }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 3,
        p: 3,
        borderBottom: isLast ? 'none' : '1px solid',
        borderColor: 'border.muted',
        '&:hover': { bg: 'canvas.subtle' },
      }}
    >
      <Box sx={{ pt: '2px' }}>
        <IssueStatusBadge issue={issue} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap' }}>
          <PrimerLink
            href={issue.html_url ?? '#'}
            target="_blank"
            rel="noreferrer"
            sx={{ fontWeight: 600, color: 'fg.default', '&:hover': { color: 'accent.fg' } }}
          >
            {issue.title}
          </PrimerLink>
          <Text sx={{ color: 'fg.muted', fontSize: 0 }}>#{issue.number}</Text>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'fg.muted', fontSize: 0, mt: 1, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
            <ClockIcon size={12} />
            opened {formatRelativeTime(issue.created_at)} by{' '}
            <Text sx={{ color: 'fg.default', fontWeight: 500 }}>{issue.author_login ?? 'unknown'}</Text>
            {issue.author_association && issue.author_association !== 'NONE' && (
              <Label variant="secondary" sx={{ ml: 1, fontSize: '10px' }}>
                {issue.author_association.toLowerCase()}
              </Label>
            )}
          </Box>
          {issue.comments > 0 && (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
              <CommentIcon size={12} />
              {issue.comments}
            </Box>
          )}
          <IssueLabels labels={issue.labels} maxVisible={4} wrap />
        </Box>
      </Box>
    </Box>
  );
}
