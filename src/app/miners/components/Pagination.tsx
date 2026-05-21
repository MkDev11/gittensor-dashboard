'use client';

import React from 'react';
import { Box, Text } from '@primer/react';
import { MONO, LABEL } from './tokens';

/* ─────────────────────────── Pagination ─────────────────────────── */

export function Pagination({
  page,
  pageCount,
  total,
  filtered,
  onPage,
  pageSize,
  zeroIndexed = false,
}: {
  page: number;
  pageCount: number;
  total: number;
  filtered: number;
  onPage: (p: number) => void;
  pageSize?: number;
  zeroIndexed?: boolean;
}) {
  if (total === 0) return null;
  const p1 = zeroIndexed ? page + 1 : page;
  const showRange = pageSize !== undefined;
  const start = showRange ? (p1 - 1) * (pageSize ?? 0) + 1 : 0;
  const end = showRange ? Math.min(p1 * (pageSize ?? 0), filtered) : 0;

  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
      {showRange && (
        <Text sx={{ ...MONO, fontSize: 0, color: 'fg.muted' }}>
          {start.toLocaleString()}–{end.toLocaleString()}
          <Text as="span" sx={{ color: 'fg.subtle' }}> / </Text>
          {filtered.toLocaleString()}
          {filtered !== total && (
            <Text as="span" sx={{ color: 'fg.subtle' }}> of {total.toLocaleString()}</Text>
          )}
        </Text>
      )}
      {!showRange && filtered !== total && (
        <Text sx={{ ...MONO, fontSize: 0, color: 'fg.muted' }}>
          {filtered.toLocaleString()} / {total.toLocaleString()}
        </Text>
      )}
      {pageCount > 1 && (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <NavBtn disabled={p1 <= 1} onClick={() => onPage(zeroIndexed ? page - 1 : page - 1)}>‹</NavBtn>
          <Text sx={{ ...MONO, fontSize: 0, minWidth: 44, textAlign: 'center', color: 'fg.muted' }}>
            <Text as="span" sx={{ color: 'fg.default', fontWeight: 700 }}>{p1}</Text>
            <Text as="span" sx={{ color: 'fg.subtle' }}> / </Text>
            {pageCount}
          </Text>
          <NavBtn disabled={p1 >= pageCount} onClick={() => onPage(zeroIndexed ? page + 1 : page + 1)}>›</NavBtn>
        </Box>
      )}
    </Box>
  );
}

function NavBtn({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Box
      as="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 1,
        bg: 'canvas.default',
        color: disabled ? 'fg.subtle' : 'fg.default',
        fontSize: 1,
        lineHeight: 1,
        fontFamily: 'inherit',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        '&:focus': { outline: 'none' },
        '&:focus-visible': { outline: '1px solid var(--fg-default)', outlineOffset: '1px' },
        '&:hover': disabled ? undefined : { bg: 'canvas.inset', borderColor: 'border.muted' },
      }}
    >
      {children}
    </Box>
  );
}

/* ─────────────────────────── Row-size selector ─────────────────────────── */

const CHEVRON_DOWN_URL =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 16 16' fill='%238b949e'><path d='M3.22 5.22a.75.75 0 0 1 1.06 0L8 8.94l3.72-3.72a.75.75 0 0 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 6.28a.75.75 0 0 1 0-1.06Z'/></svg>\")";

// `All` is encoded as `Infinity` so callers can use the value with `Array.slice(0, n)`.
export function RowSizeSelector({
  value,
  onChange,
  options = [10, 25, 50, 100],
  total,
  filtered,
  showAll = true,
  label = 'Rows',
}: {
  value: number;
  onChange: (n: number) => void;
  options?: number[];
  total?: number;
  filtered?: number;
  showAll?: boolean;
  label?: string;
}) {
  const showCount = typeof total === 'number' && typeof filtered === 'number';
  const visible = value === Infinity ? (filtered ?? 0) : Math.min(value, filtered ?? 0);
  const selectValue = value === Infinity ? 'all' : String(value);

  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        <Text sx={{ ...LABEL, color: 'fg.muted', textTransform: 'none', fontWeight: 600, letterSpacing: 0 }}>
          {label}:
        </Text>
        <Box
          as="select"
          value={selectValue}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            const v = e.target.value;
            onChange(v === 'all' ? Infinity : Number.parseInt(v, 10));
          }}
          sx={{
            appearance: 'none',
            WebkitAppearance: 'none',
            MozAppearance: 'none',
            fontFamily: 'mono',
            fontVariantNumeric: 'tabular-nums',
            fontSize: 0,
            fontWeight: 700,
            lineHeight: 1,
            color: 'fg.default',
            bg: 'canvas.default',
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 1,
            pl: '8px',
            pr: '22px',
            py: '3px',
            height: 22,
            cursor: 'pointer',
            backgroundImage: CHEVRON_DOWN_URL,
            backgroundPosition: 'right 6px center',
            backgroundRepeat: 'no-repeat',
            transition: 'border-color 100ms',
            '&:focus': { outline: 'none' },
            '&:focus-visible': { outline: '1px solid var(--fg-default)', outlineOffset: '1px', borderColor: 'border.muted' },
            '&:hover': { borderColor: 'border.muted' },
          }}
        >
          {options.map((n) => (
            <option key={n} value={String(n)}>{n}</option>
          ))}
          {showAll && <option value="all">All</option>}
        </Box>
      </Box>
      {showCount && (
        <Text sx={{ ...MONO, fontSize: 0, color: 'fg.subtle' }}>
          {'/ '}
          <Text as="span" sx={{ color: 'fg.muted' }}>{filtered!.toLocaleString()}</Text>
          {filtered !== total && (
            <Text as="span">{` of ${total!.toLocaleString()}`}</Text>
          )}
        </Text>
      )}
    </Box>
  );
}

/* ─────────────────────────── Page navigation ─────────────────────────── */

// Footer page-nav. `page` is 1-indexed; `pageSize === Infinity` is treated
// as a single page.
export function PageNav({
  page,
  pageSize,
  filteredCount,
  onPage,
}: {
  page: number;
  pageSize: number;
  filteredCount: number;
  onPage: (p: number) => void;
}) {
  if (filteredCount === 0) {
    return <Text sx={{ ...MONO, fontSize: 0, color: 'fg.muted' }}>0 of 0</Text>;
  }
  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));
  const safe = Math.min(Math.max(1, page), totalPages);
  const start = (safe - 1) * pageSize + 1;
  const end = Math.min(safe * pageSize, filteredCount);
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'fg.muted' }}>
      <Text sx={{ ...MONO, fontSize: 0 }}>
        {start.toLocaleString()}–{end.toLocaleString()}
        <Text as="span" sx={{ color: 'fg.subtle' }}>{' of '}</Text>
        {filteredCount.toLocaleString()}
      </Text>
      {totalPages > 1 && (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <PageBtn onClick={() => onPage(1)}             disabled={safe <= 1}          aria="First page">|‹</PageBtn>
          <PageBtn onClick={() => onPage(safe - 1)}      disabled={safe <= 1}          aria="Previous page">‹</PageBtn>
          <PageBtn onClick={() => onPage(safe + 1)}      disabled={safe >= totalPages} aria="Next page">›</PageBtn>
          <PageBtn onClick={() => onPage(totalPages)}    disabled={safe >= totalPages} aria="Last page">›|</PageBtn>
        </Box>
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
      onClick={disabled ? undefined : onClick}
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
        fontSize: 0,
        lineHeight: 1,
        '&:focus': { outline: 'none' },
        '&:focus-visible': { outline: '1px solid var(--fg-default)', outlineOffset: '1px' },
        '&:hover': disabled ? undefined : { color: 'fg.default', bg: 'canvas.default', borderColor: 'border.muted' },
      }}
    >
      {children}
    </Box>
  );
}
