'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { Box, Text } from '@primer/react';
import { MONO, LABEL } from '../../components';
import { SUMMARY_TONE_FG, SummaryTone } from './types';

export function ListLoading({ label }: { label: string }) {
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        p: 4,
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
        textAlign: 'center',
        color: 'fg.muted',
        fontSize: 1,
      }}
    >
      {label}
    </Box>
  );
}

export function HeroTile({
  label, value, sub, tone = 'neutral', last = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: SummaryTone;
  last?: boolean;
}) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        px: '12px',
        py: '10px',
        borderRight: last ? 'none' : '1px solid',
        borderRightColor: 'border.muted',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      <Text sx={{ ...LABEL, color: 'fg.muted' }}>{label}</Text>
      <Text
        sx={{
          ...MONO,
          fontSize: [2, null, 3],
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: 1.05,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        style={{ color: SUMMARY_TONE_FG[tone] }}
      >
        {value}
      </Text>
      {sub && (
        <Text sx={{ fontSize: '10px', color: 'fg.subtle', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sub}
        </Text>
      )}
    </Box>
  );
}

export function CountBadge({
  icon, value, label, tone = 'neutral',
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
  tone?: SummaryTone;
}) {
  const empty = value === 0 || value === '0';
  return (
    <Box
      sx={{ display: 'inline-flex', alignItems: 'center', gap: '5px', minWidth: 0 }}
      style={{ color: empty ? 'var(--fg-muted)' : SUMMARY_TONE_FG[tone], opacity: empty ? 0.55 : 1 }}
    >
      <Box sx={{ display: 'inline-flex', flexShrink: 0 }}>{icon}</Box>
      <Text sx={{ ...MONO, fontSize: '11px', fontWeight: empty ? 400 : 700, lineHeight: 1 }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </Text>
      <Text sx={{ fontSize: '10px', color: 'fg.subtle', textTransform: 'lowercase' }}>{label}</Text>
    </Box>
  );
}

export function useSearchPage<T>(
  items: T[],
  filter: (item: T, q: string) => boolean,
  pageSize = 15,
) {
  const [search, setSearchRaw] = useState('');
  const [page, setPage] = useState(0);
  const setSearch = useCallback((s: string) => { setSearchRaw(s); setPage(0); }, []);
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return q ? items.filter((i) => filter(i, q)) : items;
  // filter is a stable render-time closure; items + search are the real deps
  }, [items, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const paged = useMemo(
    () => filtered.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [filtered, safePage, pageSize],
  );
  return { search, setSearch, page: safePage, setPage, pageCount, filtered, paged };
}
