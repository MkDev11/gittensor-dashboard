'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Text } from '@primer/react';
import { SyncIcon, DatabaseIcon } from '@primer/octicons-react';
import { formatRelativeTime } from '@/lib/format';

interface PollerStatus {
  repos_cached: number;
  repos_total: number;
  issues_cached: number;
  pulls_cached: number;
  last_fetch: string | null;
}

export default function PollerStatusBar() {
  const { data } = useQuery<PollerStatus>({
    queryKey: ['poller-status'],
    queryFn: async () => {
      const r = await fetch('/api/poller-status');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 5000,
  });

  // Reserve the bar's footprint even before the first /api/poller-status
  // response — otherwise the bottom of the viewport is empty until the
  // query lands, which reads as "missing bar" mid-load.
  if (!data) {
    return (
      <Box
        sx={{
          position: 'fixed',
          bottom: 'var(--bottom-nav-height, 0px)',
          left: 'var(--sidebar-width, 240px)',
          right: 0,
          bg: 'var(--bg-subtle)',
          borderTop: '1px solid',
          borderColor: 'var(--border-default)',
          height: 30,
          display: 'flex',
          alignItems: 'center',
          gap: [2, null, 3],
          px: [2, null, 3],
          overflowX: 'auto',
          whiteSpace: 'nowrap',
          zIndex: 90,
        }}
      >
        <span className="gt-skeleton" style={{ width: 56, height: 10 }} />
        <span className="gt-skeleton" style={{ width: 92, height: 10 }} />
        <Box sx={{ display: ['none', null, 'inline-block'] }}>
          <span className="gt-skeleton" style={{ width: 120, height: 4, borderRadius: 999 }} />
        </Box>
        <span className="gt-skeleton" style={{ width: 128, height: 10 }} />
      </Box>
    );
  }

  const pct = data.repos_total > 0 ? (data.repos_cached / data.repos_total) * 100 : 0;

  return (
    <Box
      sx={{
        position: 'fixed',
        bottom: 'var(--bottom-nav-height, 0px)',
        // Sit to the right of the fixed sidebar instead of edge-to-edge so
        // the status bar doesn't overlap nav items.
        left: 'var(--sidebar-width, 240px)',
        right: 0,
        bg: 'var(--bg-subtle)',
        borderTop: '1px solid',
        borderColor: 'var(--border-default)',
        px: [2, null, 3],
        py: '6px',
        display: 'flex',
        alignItems: 'center',
        gap: [2, null, 3],
        overflowX: 'auto',
        whiteSpace: 'nowrap',
        fontSize: 0,
        color: 'var(--fg-muted)',
        zIndex: 90,
      }}
    >
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        <SyncIcon size={12} />
        <Text>Poller</Text>
      </Box>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        <DatabaseIcon size={12} />
        <Text sx={{ display: ['none', null, 'inline'] }}>
          {data.repos_cached} / {data.repos_total} repos cached
        </Text>
        <Text sx={{ display: ['inline', null, 'none'] }}>
          {data.repos_cached}/{data.repos_total} repos
        </Text>
      </Box>
      <Box sx={{ width: 120, height: 4, bg: 'var(--bg-inset)', borderRadius: 999, overflow: 'hidden', display: ['none', null, 'block'] }}>
        <Box sx={{ height: '100%', bg: 'var(--success-emphasis)', transition: 'width 200ms' }} style={{ width: `${pct}%` }} />
      </Box>
      <Text>
        {data.issues_cached.toLocaleString()} issues · {data.pulls_cached.toLocaleString()} pulls
      </Text>
      <Box sx={{ ml: 'auto' }}>
        <Text>last sync {formatRelativeTime(data.last_fetch)}</Text>
      </Box>
    </Box>
  );
}
