import React from 'react';
import { Box, Text } from '@primer/react';
import { ChevronLeftIcon, ChevronRightIcon } from '@primer/octicons-react';
import Dropdown from '@/components/Dropdown';

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10' },
  { value: '25', label: '25' },
  { value: '50', label: '50' },
  { value: '100', label: '100' },
];

export function DoubleChevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      {dir === 'left' ? (
        <>
          <path d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z" fill="currentColor" />
          <path d="M5.78 4.22a.75.75 0 0 1 0 1.06L3.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L1.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z" fill="currentColor" />
        </>
      ) : (
        <>
          <path d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 1 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" fill="currentColor" />
          <path d="M10.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 1 1-1.06-1.06L12.94 8l-2.72-2.72a.75.75 0 0 1 0-1.06Z" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

export function PageSizeDropdown({
  value,
  onChange,
  width = 72,
}: {
  value: number;
  onChange: (n: number) => void;
  width?: number;
}) {
  return (
    <Dropdown
      value={String(value)}
      onChange={(v) => onChange(parseInt(v, 10))}
      options={PAGE_SIZE_OPTIONS}
      width={width}
      size="small"
      ariaLabel="Rows per page"
    />
  );
}

type PaginationProps = {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onChange: (next: number) => void;
  onPageSizeChange?: (size: number) => void;
  rawPageSize?: number;
};

export function InlinePagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onChange,
  onPageSizeChange,
  rawPageSize,
}: PaginationProps) {
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);
  const showPageNav = totalItems > pageSize;

  const navBtn = (label: React.ReactNode, target: number, disabled: boolean | undefined, aria: string) => (
    <button
      key={aria}
      type="button"
      onClick={() => onChange(target)}
      disabled={disabled}
      aria-label={aria}
      title={aria}
      className="gt-pag-btn"
      data-disabled={disabled ? 'true' : 'false'}
    >
      {label}
    </button>
  );

  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 0 }}>
      <Text sx={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
        <strong>{showPageNav ? start : 1}</strong>–<strong>{showPageNav ? end : totalItems}</strong> of{' '}
        <strong>{totalItems}</strong>
      </Text>
      {onPageSizeChange && (
        <PageSizeDropdown value={rawPageSize ?? pageSize} onChange={onPageSizeChange} />
      )}
      {showPageNav && (
        <Box className="gt-pag-group">
          {navBtn(<DoubleChevron dir="left" />, 1, page <= 1, 'First page')}
          {navBtn(<ChevronLeftIcon size={14} />, page - 1, page <= 1, 'Previous page')}
          <Box className="gt-pag-label">
            <Text sx={{ color: 'var(--fg-default)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {page}
            </Text>
            <Text sx={{ color: 'var(--fg-muted)', mx: '4px' }}>/</Text>
            <Text sx={{ color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>
              {totalPages}
            </Text>
          </Box>
          {navBtn(<ChevronRightIcon size={14} />, page + 1, page >= totalPages, 'Next page')}
          {navBtn(<DoubleChevron dir="right" />, totalPages, page >= totalPages, 'Last page')}
        </Box>
      )}
    </Box>
  );
}

export function Pagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onChange,
  onPageSizeChange,
  rawPageSize,
}: PaginationProps) {
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  const btn = (label: React.ReactNode, target: number, disabled?: boolean, active?: boolean) => (
    <button
      key={`${label}-${target}`}
      type="button"
      onClick={() => onChange(target)}
      disabled={disabled}
      style={{
        minWidth: 32,
        height: 28,
        padding: '0 10px',
        border: '1px solid var(--border-default)',
        borderRadius: 6,
        background: active ? 'var(--accent-emphasis)' : 'var(--bg-canvas)',
        color: active ? '#ffffff' : disabled ? 'var(--fg-subtle)' : 'var(--fg-default)',
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontFamily: 'inherit',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {label}
    </button>
  );

  // Build a windowed page-number list (current ± 2, plus first/last with ellipses)
  const numbers: (number | '…')[] = [];
  const window = 1;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - window && i <= page + window)) {
      numbers.push(i);
    } else if (numbers[numbers.length - 1] !== '…') {
      numbers.push('…');
    }
  }

  const showPageNav = totalItems > pageSize;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        px: 3,
        py: 2,
        borderTop: '1px solid',
        borderColor: 'var(--border-default)',
        bg: 'var(--bg-subtle)',
        flexShrink: 0,
        flexWrap: 'wrap',
      }}
    >
      <Box sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>
        Showing <strong>{showPageNav ? start : 1}</strong>–<strong>{showPageNav ? end : totalItems}</strong> of <strong>{totalItems}</strong>
      </Box>

      {onPageSizeChange && (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>Rows per page</Text>
          <PageSizeDropdown value={rawPageSize ?? pageSize} onChange={onPageSizeChange} width={88} />
        </Box>
      )}

      {showPageNav && (
        <Box sx={{ ml: 'auto', display: 'inline-flex', alignItems: 'center', gap: 1 }}>
          {btn(<ChevronLeftIcon size={14} />, page - 1, page <= 1)}
          {numbers.map((n, i) =>
            n === '…' ? (
              <span key={`e-${i}`} style={{ color: 'var(--fg-muted)', padding: '0 4px' }}>
                …
              </span>
            ) : (
              btn(n, n, false, n === page)
            )
          )}
          {btn(<ChevronRightIcon size={14} />, page + 1, page >= totalPages)}
        </Box>
      )}
    </Box>
  );
}
