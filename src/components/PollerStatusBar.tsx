'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Box, Text } from '@primer/react';
import { SyncIcon, DatabaseIcon } from '@primer/octicons-react';
import { formatRelativeTime } from '@/lib/format';

// Pre-auth routes where polling would just rack up 401s and the bar shouldn't show.
const NO_POLL_ROUTES = new Set(['/sign-in']);

interface PollerStatus {
  repos_cached: number;
  repos_total: number;
  issues_cached: number;
  pulls_cached: number;
  last_fetch: string | null;
}

function compactCount(value: number): string {
  return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export default function PollerStatusBar() {
  const pathname = usePathname();
  const enabled = !NO_POLL_ROUTES.has(pathname);
  const { data } = useQuery<PollerStatus>({
    queryKey: ['poller-status'],
    queryFn: async () => {
      const r = await fetch('/api/poller-status');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 5000,
    enabled,
  });
  if (!enabled) return null;

  // Reserve the bar's footprint even before the first /api/poller-status
  // response — otherwise the bottom of the viewport is empty until the
  // query lands, which reads as "missing bar" mid-load.
  if (!data) {
    return (
      <Box
        data-poller-status-bar=""
        sx={{
          bg: 'var(--bg-subtle)',
          borderTop: '1px solid',
          borderColor: 'var(--border-default)',
          height: 'auto',
          minHeight: 'auto',
          display: ['grid', null, 'flex'],
          gridTemplateColumns: ['auto minmax(0, 1fr) auto', null, 'none'],
          gridTemplateAreas: ['"poller repos sync" "counts counts counts"', null, 'none'],
          alignItems: 'center',
          gap: ['4px 8px', null, 3],
          px: [2, null, 3],
          py: ['6px', null, '6px'],
          overflow: 'hidden',
          whiteSpace: ['normal', null, 'nowrap'],
        }}
      >
        <Box sx={{ gridArea: ['poller', null, 'auto'] }}>
          <span className="gt-skeleton" style={{ display: 'block', width: 56, height: 10 }} />
        </Box>
        <Box sx={{ gridArea: ['repos', null, 'auto'] }}>
          <span className="gt-skeleton" style={{ display: 'block', width: 92, height: 10 }} />
        </Box>
        <Box sx={{ display: ['none', null, 'inline-block'] }}>
          <span className="gt-skeleton" style={{ width: 120, height: 4, borderRadius: 999 }} />
        </Box>
        <Box sx={{ gridArea: ['counts', null, 'auto'] }}>
          <span className="gt-skeleton" style={{ display: 'block', width: 128, height: 10 }} />
        </Box>
      </Box>
    );
  }

  const pct = data.repos_total > 0 ? (data.repos_cached / data.repos_total) * 100 : 0;

  return (
    <Box
      data-poller-status-bar=""
      sx={{
        // In-flow as the last child of <main> so it sits right after the page
        // content (no floating, no gap). Spans the content column since <main>
        // is already offset from the fixed sidebar by the body's padding-left.
        bg: 'var(--bg-subtle)',
        borderTop: '1px solid',
        borderColor: 'var(--border-default)',
        px: [2, null, 3],
        py: ['6px', null, '6px'],
        height: 'auto',
        minHeight: 'auto',
        display: ['grid', null, 'flex'],
        gridTemplateColumns: ['auto minmax(0, 1fr) auto', null, 'none'],
        gridTemplateAreas: ['"poller repos sync" "counts counts counts"', null, 'none'],
        alignItems: 'center',
        gap: ['4px 8px', null, 3],
        overflow: 'hidden',
        whiteSpace: ['normal', null, 'nowrap'],
        fontSize: 0,
        lineHeight: 1.2,
        color: 'var(--fg-muted)',
      }}
    >
      <Box sx={{ gridArea: ['poller', null, 'auto'], display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <SyncIcon size={12} />
        <Text sx={{ fontWeight: 600 }}>Poller</Text>
      </Box>
      <Box sx={{ gridArea: ['repos', null, 'auto'], display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <DatabaseIcon size={12} />
        <Text sx={{ display: ['none', null, 'inline'] }}>
          {data.repos_cached} / {data.repos_total} repos cached
        </Text>
        <Text sx={{ display: ['inline', null, 'none'] }}>
          repos {data.repos_cached}/{data.repos_total}
        </Text>
      </Box>
      <Box sx={{ width: 120, height: 4, bg: 'var(--bg-inset)', borderRadius: 999, overflow: 'hidden', display: ['none', null, 'block'] }}>
        <Box sx={{ height: '100%', bg: 'var(--success-emphasis)', transition: 'width 200ms' }} style={{ width: `${pct}%` }} />
      </Box>
      <Text sx={{ display: ['none', null, 'inline'] }}>
        {data.issues_cached.toLocaleString()} issues · {data.pulls_cached.toLocaleString()} pulls
      </Text>
      <Text sx={{ gridArea: ['counts', null, 'auto'], display: ['block', null, 'none'], minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {compactCount(data.issues_cached)} issues · {compactCount(data.pulls_cached)} PRs
      </Text>
      <Box sx={{ gridArea: ['sync', null, 'auto'], justifySelf: ['end', null, 'auto'], ml: ['0', null, 'auto'], color: 'fg.subtle', minWidth: 0 }}>
        <Text sx={{ display: ['none', null, 'inline'] }}>last sync {formatRelativeTime(data.last_fetch)}</Text>
        <Text sx={{ display: ['inline', null, 'none'] }}>sync {formatRelativeTime(data.last_fetch)}</Text>
      </Box>
    </Box>
  );
}
