'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Label, Link as PrimerLink, Text } from '@primer/react';
import { MarkGithubIcon, XIcon } from '@primer/octicons-react';
import Spinner from '@/components/Spinner';
import { TableRowsSkeleton } from '@/components/Skeleton';
import { IssueStatusBadge } from '@/components/StatusBadge';
import { formatRelativeTime, isRecent } from '@/lib/format';
import type { Issue } from '@/types/entities';

interface AuthorIssuesResponse {
  repo: string;
  author: {
    login: string;
    association: string | null;
    avatar_url: string;
    html_url: string;
  };
  stats: {
    total: number;
    open: number;
    completed: number;
    not_planned: number;
    closed: number;
    last_updated_at: string | null;
  };
  issues: Array<Issue & { merged_pr_count: number }>;
}

export default function AuthorSidebar({
  owner,
  name,
  repoFullName,
  login,
  initialAssociation,
  onClose,
  onIssueClick,
}: {
  owner: string;
  name: string;
  repoFullName: string;
  login: string;
  initialAssociation: string | null;
  onClose: () => void;
  onIssueClick: (issue: Issue) => void;
}) {
  const { data, isLoading, isError } = useQuery<AuthorIssuesResponse>({
    queryKey: ['author-issues', owner, name, login],
    queryFn: async () => {
      const r = await fetch(
        `/api/repos/${owner}/${name}/authors/${encodeURIComponent(login)}/issues?limit=100`,
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const association = data?.author.association ?? initialAssociation;
  const showAssociation = association && association !== 'NONE';
  const stats = data?.stats;
  const issues = data?.issues ?? [];

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Box
        sx={{
          p: 3,
          borderBottom: '1px solid',
          borderColor: 'var(--border-default)',
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          flexShrink: 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={data?.author.avatar_url ?? `https://github.com/${login}.png?size=96`}
          alt={login}
          loading="lazy"
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            border: '1px solid var(--border-default)',
            flexShrink: 0,
          }}
        />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
            <Text
              sx={{
                color: 'var(--fg-default)',
                fontWeight: 700,
                fontSize: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {login}
            </Text>
            {showAssociation && (
              <Label variant="secondary" sx={{ fontSize: '10px', flexShrink: 0 }}>
                {association.toLowerCase()}
              </Label>
            )}
          </Box>
          <Text sx={{ color: 'var(--fg-muted)', fontSize: 0, display: 'block', mt: 1 }}>
            {repoFullName}
          </Text>
        </Box>
        <PrimerLink
          href={data?.author.html_url ?? `https://github.com/${login}`}
          target="_blank"
          rel="noreferrer"
          sx={{ color: 'var(--fg-muted)', display: 'inline-flex', '&:hover': { color: 'var(--accent-fg)' } }}
          title="Open GitHub profile"
        >
          <MarkGithubIcon size={16} />
        </PrimerLink>
        <Box
          as="button"
          type="button"
          onClick={onClose}
          title="Close"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            border: '1px solid',
            borderColor: 'var(--border-default)',
            borderRadius: 2,
            bg: 'var(--bg-canvas)',
            color: 'var(--fg-muted)',
            cursor: 'pointer',
            '&:hover': { color: 'var(--fg-default)', borderColor: 'var(--border-strong)' },
          }}
        >
          <XIcon size={14} />
        </Box>
      </Box>

      <Box sx={{ px: 3, py: 2, borderBottom: '1px solid', borderColor: 'var(--border-muted)', flexShrink: 0 }}>
        {isLoading && !data ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--fg-muted)', fontSize: 0 }}>
            <Spinner size="sm" tone="muted" />
            <Text>Loading author...</Text>
          </Box>
        ) : isError ? (
          <Text sx={{ color: 'var(--danger-fg)', fontSize: 0 }}>Could not load author issues.</Text>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 2, textAlign: 'center' }}>
            <Metric label="Total" value={stats?.total ?? issues.length} fg="var(--fg-default)" bg="var(--bg-emphasis)" />
            <Metric label="Open" value={stats?.open ?? 0} fg="var(--success-fg)" bg="var(--success-subtle)" />
            <Metric label="Done" value={stats?.completed ?? 0} fg="var(--done-fg)" bg="var(--done-subtle)" />
            <Metric label="NP" value={stats?.not_planned ?? 0} fg="var(--fg-muted)" bg="var(--bg-emphasis)" />
            <Metric label="CL" value={stats?.closed ?? 0} fg="var(--danger-fg)" bg="var(--danger-subtle)" />
          </Box>
        )}
      </Box>

      <Box sx={{ px: 3, py: 2, color: 'var(--fg-muted)', fontSize: 0, flexShrink: 0 }}>
        Latest issues{stats?.last_updated_at ? ` - updated ${formatRelativeTime(stats.last_updated_at)}` : ''}
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {isLoading && !data ? (
          <TableRowsSkeleton
            rows={6}
            cols={[
              { width: 80 },
              { width: 40 },
              { flex: 1 },
              { width: 80 },
            ]}
          />
        ) : !isLoading && !isError && issues.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center', color: 'var(--fg-muted)' }}>
            No cached issues by {login} in this repo.
          </Box>
        ) : (
          <Box as="table" sx={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 0 }}>
            <Box as="thead" sx={{ position: 'sticky', top: 0, bg: 'var(--bg-subtle)', zIndex: 1 }}>
              <Box as="tr">
                <Box as="th" sx={{ ...tableHeaderSx, width: 96 }}>State</Box>
                <Box as="th" sx={{ ...tableHeaderSx, width: 56 }}>No</Box>
                <Box as="th" sx={tableHeaderSx}>Issue</Box>
                <Box as="th" sx={{ ...tableHeaderSx, width: 112 }}>Updated</Box>
              </Box>
            </Box>
            <Box as="tbody">
              {issues.map((issue, index) => (
                <Box
                  as="tr"
                  key={issue.id}
                  onClick={() => onIssueClick(issue)}
                  sx={{
                    borderBottom: '1px solid',
                    borderColor: 'var(--border-muted)',
                    cursor: 'pointer',
                    '&:hover': { bg: 'var(--bg-subtle)' },
                  }}
                >
                  <Box as="td" sx={tableCellSx}>
                    <IssueStatusBadge issue={issue} mergedPRCount={issue.merged_pr_count} />
                  </Box>
                  <Box
                    as="td"
                    sx={{
                      ...tableCellSx,
                      color: 'var(--fg-muted)',
                      fontFamily: 'mono',
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {index + 1}
                  </Box>
                  <Box as="td" sx={{ ...tableCellSx, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap', minWidth: 0 }}>
                      <Text
                        sx={{
                          color: 'var(--fg-default)',
                          fontWeight: 500,
                          lineHeight: 1.35,
                          whiteSpace: 'normal',
                          wordBreak: 'break-word',
                        }}
                        title={issue.title}
                      >
                        {issue.title}
                      </Text>
                      <Text
                        sx={{
                          color: 'var(--fg-muted)',
                          fontFamily: 'mono',
                          fontVariantNumeric: 'tabular-nums',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}
                      >
                        #{issue.number}
                      </Text>
                    </Box>
                  </Box>
                  <Box as="td" sx={tableTimeSx} title={issue.updated_at ?? undefined}>
                    <RecentTime iso={issue.updated_at} />
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function Metric({ label, value, fg, bg }: { label: string; value: number; fg: string; bg: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <CountBadge n={value} fg={fg} bg={bg} />
      <Text sx={{ display: 'block', color: 'var(--fg-muted)', fontSize: '10px', mt: 1 }}>{label}</Text>
    </Box>
  );
}

const RecentTime = React.memo(function RecentTime({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <Text sx={{ color: 'var(--fg-muted)' }}>-</Text>;
  const recent = isRecent(iso);
  if (recent) {
    return (
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            bg: 'var(--success-emphasis)',
            display: 'inline-block',
            animation: 'gtPulse 1.6s ease-in-out infinite',
          }}
        />
        <Text sx={{ color: 'var(--success-fg)', fontWeight: 700 }}>
          {formatRelativeTime(iso)}
        </Text>
      </Box>
    );
  }
  return <Text sx={{ color: 'var(--fg-muted)' }}>{formatRelativeTime(iso)}</Text>;
});

const CountBadge = React.memo(function CountBadge({ n, fg, bg }: { n: number; fg: string; bg: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        minWidth: 22,
        padding: '1px 8px',
        borderRadius: 999,
        background: bg,
        color: fg,
        textAlign: 'center',
      }}
    >
      {n}
    </span>
  );
});

const tableHeaderSx = {
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

const tableCellSx = {
  px: 2,
  py: '6px',
  height: 36,
  verticalAlign: 'middle' as const,
  cursor: 'pointer',
};

const tableTimeSx = {
  ...tableCellSx,
  fontSize: 0,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap' as const,
  cursor: 'pointer',
};
