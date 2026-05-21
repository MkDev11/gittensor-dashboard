'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from '@primer/react';
import {
  IssueOpenedIcon, IssueClosedIcon, SkipIcon, CommentDiscussionIcon, LinkExternalIcon,
} from '@primer/octicons-react';
import { formatRelativeTime } from '@/lib/format';
import {
  Card, CardHeader, RowSizeSelector, SearchBox, PageNav, MONO,
} from '../../components';
import type { IssueDetail } from './types';

export interface IssueListProps {
  issues: IssueDetail[];
  title: string;
  sub?: string;
  /** Disambiguates row keys when the same issue appears in both "discovered" and "solved" lists. */
  kind: 'discovered' | 'solved';
  icon: React.ReactNode;
}

export function IssueList({ issues, title, sub, kind, icon }: IssueListProps) {
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

/* ─────────────────────────── Row ─────────────────────────── */

function IssueRow({ iss }: { iss: IssueDetail }) {
  const stateColor =
    iss.bucket === 'solved' || iss.bucket === 'completed' ? 'done.fg'
    : iss.bucket === 'open' ? 'success.fg'
    : 'danger.fg';
  const StateIcon = iss.bucket === 'open' ? IssueOpenedIcon : iss.bucket === 'closed' ? SkipIcon : IssueClosedIcon;
  const stateLabel = iss.bucket === 'solved' ? 'Solved' : iss.bucket === 'completed' ? 'Completed' : iss.bucket === 'open' ? 'Open' : 'Closed';
  const stateColorVar = stateColor.includes('done') ? 'var(--done-fg)' : stateColor.includes('success') ? 'var(--success-fg)' : 'var(--danger-fg)';

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
      <Text sx={{ display: ['none', null, 'block'], fontSize: 0, fontWeight: 700 }} style={{ color: stateColorVar }}>
        {stateLabel}
      </Text>
      <Text sx={{ ...MONO, display: ['none', null, 'block'], fontSize: '10px' }} style={{ color: stateColorVar }}>
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
