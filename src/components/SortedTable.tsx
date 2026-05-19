'use client';

import React from 'react';
import { Box } from '@primer/react';
import { TriangleDownIcon, TriangleUpIcon } from '@primer/octicons-react';
import { TableRowsSkeleton } from '@/components/Skeleton';
import type { SortDir } from '@/lib/list-data/useListData';

type BoxSx = NonNullable<React.ComponentProps<typeof Box>['sx']>;

export interface SortedTableColumn<T, S extends string> {
  /** Stable column id — used as the React key. */
  key: string;
  label: React.ReactNode;
  /** Set to make the header clickable; passed back to `onSort`. */
  sortKey?: S;
  align?: 'left' | 'right' | 'center';
  /** Static cell styling. Per-row dynamic styling belongs inside `render`. */
  cellSx?: BoxSx;
  headerSx?: BoxSx;
  /** Skeleton width hint while loading. Omit for flex-grow. */
  skeletonWidth?: number;
  render: (row: T) => React.ReactNode;
}

export interface SortedTableProps<T, S extends string> {
  columns: ReadonlyArray<SortedTableColumn<T, S>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T) => string;
  sortKey: S;
  sortDir: SortDir;
  onSort: (key: S) => void;
  onRowClick?: (row: T) => void;
  /** Highlights the row and (if `renderExpanded` returns truthy) appends an expansion `<tr>`. */
  isExpanded?: (row: T) => boolean;
  renderExpanded?: (row: T) => React.ReactNode;
  loading?: boolean;
  /** Rendered when `rows` is empty and `loading` is false. */
  empty?: React.ReactNode;
  /** Forces horizontal scroll below this width. */
  minWidth?: number;
  /** Skeleton row count while loading with no data. */
  skeletonRows?: number;
}

const headerBaseSx: BoxSx = {
  px: 3,
  py: 2,
  textAlign: 'left',
  fontWeight: 600,
  fontSize: '11px',
  color: 'fg.muted',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  whiteSpace: 'nowrap',
};

/**
 * Generic table renderer driven by a column config. Owns header chrome, sort
 * indicators, skeleton/empty fallbacks, row click + expansion. Sort/filter
 * state is held outside (typically by `useListData`).
 */
export function SortedTable<T, S extends string>({
  columns,
  rows,
  rowKey,
  sortKey,
  sortDir,
  onSort,
  onRowClick,
  isExpanded,
  renderExpanded,
  loading = false,
  empty,
  minWidth = 900,
  skeletonRows = 10,
}: SortedTableProps<T, S>) {
  const showSkeleton = loading && rows.length === 0;
  const showEmpty = !loading && rows.length === 0;

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.default',
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      {showSkeleton ? (
        <TableRowsSkeleton
          rows={skeletonRows}
          cols={columns.map((c) =>
            c.skeletonWidth ? { width: c.skeletonWidth } : { flex: 1 },
          )}
        />
      ) : showEmpty ? (
        empty != null ? (
          <Box sx={{ p: 4, textAlign: 'center', color: 'fg.muted' }}>{empty}</Box>
        ) : null
      ) : (
        <Box
          as="table"
          sx={{ width: '100%', minWidth, borderCollapse: 'collapse', fontSize: 1 }}
        >
          <Box
            as="thead"
            sx={{
              bg: 'canvas.subtle',
              borderBottom: '1px solid',
              borderColor: 'border.default',
            }}
          >
            <Box as="tr">
              {columns.map((col) => (
                <HeaderCell
                  key={col.key}
                  column={col}
                  active={col.sortKey === sortKey}
                  dir={sortDir}
                  onSort={onSort}
                />
              ))}
            </Box>
          </Box>
          <Box as="tbody">
            {rows.map((row) => {
              const key = rowKey(row);
              const expanded = isExpanded?.(row) ?? false;
              const expansion = expanded ? renderExpanded?.(row) : null;
              return (
                <React.Fragment key={key}>
                  <Box
                    as="tr"
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    data-explorer-row="true"
                    sx={{
                      borderBottom: '1px solid',
                      borderColor: 'border.muted',
                      bg: expanded ? 'accent.muted' : 'canvas.default',
                      cursor: onRowClick ? 'pointer' : 'default',
                      '&:hover': onRowClick ? { bg: 'canvas.subtle' } : undefined,
                    }}
                  >
                    {columns.map((col) => (
                      <Box
                        as="td"
                        key={col.key}
                        sx={{
                          p: 2,
                          verticalAlign: 'middle',
                          textAlign: col.align ?? 'left',
                          ...col.cellSx,
                        }}
                      >
                        {col.render(row)}
                      </Box>
                    ))}
                  </Box>
                  {expansion ? (
                    <Box as="tr">
                      <Box as="td" colSpan={columns.length} sx={{ p: 0 }}>
                        {expansion}
                      </Box>
                    </Box>
                  ) : null}
                </React.Fragment>
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
}

function HeaderCell<T, S extends string>({
  column,
  active,
  dir,
  onSort,
}: {
  column: SortedTableColumn<T, S>;
  active: boolean;
  dir: SortDir;
  onSort: (key: S) => void;
}) {
  const sortable = column.sortKey !== undefined;
  const align = column.align ?? 'left';
  const sx: BoxSx = {
    ...headerBaseSx,
    textAlign: align,
    ...column.headerSx,
    ...(sortable
      ? { cursor: 'pointer', userSelect: 'none', '&:hover': { color: 'fg.default' } }
      : null),
  };
  return (
    <Box
      as="th"
      sx={sx}
      onClick={sortable ? () => onSort(column.sortKey as S) : undefined}
    >
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        {column.label}
        {sortable && active ? (
          dir === 'asc' ? (
            <TriangleUpIcon size={12} />
          ) : (
            <TriangleDownIcon size={12} />
          )
        ) : null}
      </Box>
    </Box>
  );
}
