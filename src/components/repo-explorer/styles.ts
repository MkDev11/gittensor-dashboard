export type SortDir = 'asc' | 'desc';

export const tableHeaderSx = {
  px: 2,
  py: '6px',
  textAlign: 'left' as const,
  fontWeight: 600,
  fontSize: '11px',
  color: 'var(--fg-muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  whiteSpace: 'nowrap' as const,
  borderBottom: '1px solid',
  borderColor: 'var(--border-default)',
};

export const tableCellSx = {
  px: 2,
  py: '6px',
  height: 36,
  verticalAlign: 'middle' as const,
  cursor: 'pointer',
};

export const tableTimeSx = {
  ...tableCellSx,
  fontSize: 0,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap' as const,
  cursor: 'pointer',
};
