'use client';

import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Label, Link as PrimerLink, Text } from '@primer/react';
import { MarkGithubIcon, XIcon } from '@primer/octicons-react';
import Spinner from '@/components/Spinner';
import { TableRowsSkeleton } from '@/components/Skeleton';
import { IssueStatusBadge, PullStatusBadge } from '@/components/StatusBadge';
import AuthorCredibilityNote from '@/components/AuthorCredibilityNote';
import { formatRelativeTime, isRecent } from '@/lib/format';
import type { AuthorCredibility, Issue, Pull } from '@/types/entities';
import { InlinePagination as TablePagination } from '@/components/repo-explorer/Pagination';

const AUTHOR_PAGE_SIZE = 15;

interface AuthorPullsResponse {
  repo: string;
  page: number;
  page_size: number;
  total_pages: number;
  author: {
    login: string;
    association: string | null;
    avatar_url: string;
    html_url: string;
    credibility: AuthorCredibility | null;
  };
  stats: {
    total: number;
    open: number;
    draft: number;
    merged: number;
    closed: number;
    last_updated_at: string | null;
  };
  pulls: Pull[];
}

interface AuthorIssuesResponse {
  repo: string;
  page: number;
  page_size: number;
  total_pages: number;
  author: {
    login: string;
    association: string | null;
    avatar_url: string;
    html_url: string;
    credibility: AuthorCredibility | null;
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

export default function AuthorActivitySidebar({
  owner,
  name,
  repoFullName,
  login,
  initialAssociation,
  initialTab = 'pulls',
  onClose,
  onPullClick,
  onIssueClick,
}: {
  owner: string;
  name: string;
  repoFullName: string;
  login: string;
  initialAssociation: string | null;
  initialTab?: 'pulls' | 'issues';
  onClose: () => void;
  onPullClick: (pull: Pull) => void;
  onIssueClick: (issue: Issue) => void;
}) {
  const [activeTab, setActiveTab] = useState<'pulls' | 'issues'>(initialTab);
  const [pullsPage, setPullsPage] = useState(1);
  const [issuesPage, setIssuesPage] = useState(1);
  const { data, isLoading, isError } = useQuery<AuthorPullsResponse>({
    queryKey: ['author-pulls', owner, name, login, pullsPage, AUTHOR_PAGE_SIZE],
    queryFn: async () => {
      const r = await fetch(
        `/api/repos/${owner}/${name}/authors/${encodeURIComponent(login)}/pulls?page=${pullsPage}&pageSize=${AUTHOR_PAGE_SIZE}`,
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const {
    data: issuesData,
    isLoading: issuesLoading,
    isError: issuesError,
  } = useQuery<AuthorIssuesResponse>({
    queryKey: ['author-issues', owner, name, login, issuesPage, AUTHOR_PAGE_SIZE],
    queryFn: async () => {
      const r = await fetch(
        `/api/repos/${owner}/${name}/authors/${encodeURIComponent(login)}/issues?page=${issuesPage}&pageSize=${AUTHOR_PAGE_SIZE}`,
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const association = data?.author.association ?? issuesData?.author.association ?? initialAssociation;
  const showAssociation = association && association !== 'NONE';
  const stats = data?.stats;
  const pulls = data?.pulls ?? [];
  const issueStats = issuesData?.stats;
  const issues = issuesData?.issues ?? [];
  const headerCredibility = activeTab === 'issues'
    ? issuesData?.author.credibility ?? data?.author.credibility
    : data?.author.credibility ?? issuesData?.author.credibility;
  const pullTotalPages = data?.total_pages ?? pullsPage;
  const issueTotalPages = issuesData?.total_pages ?? issuesPage;
  const safePullsPage = Math.min(pullsPage, pullTotalPages);
  const safeIssuesPage = Math.min(issuesPage, issueTotalPages);
  const activeTotalItems = activeTab === 'pulls' ? stats?.total ?? 0 : issueStats?.total ?? 0;
  const activeTotalPages = activeTab === 'pulls' ? pullTotalPages : issueTotalPages;
  const activePage = activeTab === 'pulls' ? safePullsPage : safeIssuesPage;
  const activePageSetter = activeTab === 'pulls' ? setPullsPage : setIssuesPage;

  useEffect(() => {
    if (data && pullsPage > data.total_pages) setPullsPage(data.total_pages);
  }, [data, pullsPage]);

  useEffect(() => {
    if (issuesData && issuesPage > issuesData.total_pages) setIssuesPage(issuesData.total_pages);
  }, [issuesData, issuesPage]);

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
            <AuthorCredibilityNote
              credibility={headerCredibility}
              variant={activeTab === 'issues' ? 'issues' : 'pulls'}
            />
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
        {activeTab === 'pulls' && isLoading && !data ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--fg-muted)', fontSize: 0 }}>
            <Spinner size="sm" tone="muted" />
            <Text>Loading author PRs...</Text>
          </Box>
        ) : activeTab === 'pulls' && isError ? (
          <Text sx={{ color: 'var(--danger-fg)', fontSize: 0 }}>Could not load author PRs.</Text>
        ) : activeTab === 'issues' && issuesLoading && !issuesData ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--fg-muted)', fontSize: 0 }}>
            <Spinner size="sm" tone="muted" />
            <Text>Loading author issues...</Text>
          </Box>
        ) : activeTab === 'issues' && issuesError ? (
          <Text sx={{ color: 'var(--danger-fg)', fontSize: 0 }}>Could not load author issues.</Text>
        ) : activeTab === 'issues' ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 2, textAlign: 'center' }}>
            <Metric label="Total" value={issueStats?.total ?? issues.length} fg="var(--fg-default)" bg="var(--bg-emphasis)" />
            <Metric label="Open" value={issueStats?.open ?? 0} fg="var(--success-fg)" bg="var(--success-subtle)" />
            <Metric label="Done" value={issueStats?.completed ?? 0} fg="var(--done-fg)" bg="var(--done-subtle)" />
            <Metric label="NP" value={issueStats?.not_planned ?? 0} fg="var(--fg-muted)" bg="var(--bg-emphasis)" />
            <Metric label="CL" value={issueStats?.closed ?? 0} fg="var(--danger-fg)" bg="var(--danger-subtle)" />
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 2, textAlign: 'center' }}>
            <Metric label="Total" value={stats?.total ?? pulls.length} fg="var(--fg-default)" bg="var(--bg-emphasis)" />
            <Metric label="Open" value={stats?.open ?? 0} fg="var(--success-fg)" bg="var(--success-subtle)" />
            <Metric label="Draft" value={stats?.draft ?? 0} fg="var(--fg-muted)" bg="var(--bg-emphasis)" />
            <Metric label="Merged" value={stats?.merged ?? 0} fg="var(--done-fg)" bg="var(--done-subtle)" />
            <Metric label="Closed" value={stats?.closed ?? 0} fg="var(--danger-fg)" bg="var(--danger-subtle)" />
          </Box>
        )}
      </Box>

      <Box
        sx={{
          px: 3,
          pt: 2,
          borderBottom: '1px solid',
          borderColor: 'var(--border-default)',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 3,
          flexShrink: 0,
        }}
      >
        <AuthorTab
          active={activeTab === 'issues'}
          onClick={() => setActiveTab('issues')}
          label="Issues"
          count={issueStats?.total ?? issues.length}
        />
        <AuthorTab
          active={activeTab === 'pulls'}
          onClick={() => setActiveTab('pulls')}
          label="Pull requests"
          count={stats?.total ?? pulls.length}
        />
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        <Box sx={{ px: 3, py: 2, color: 'var(--fg-muted)', fontSize: 0 }}>
          {activeTab === 'pulls'
            ? `Latest pull requests${stats?.last_updated_at ? ` - updated ${formatRelativeTime(stats.last_updated_at)}` : ''}`
            : `Latest issues${issueStats?.last_updated_at ? ` - updated ${formatRelativeTime(issueStats.last_updated_at)}` : ''}`}
        </Box>
        {activeTab === 'pulls' && isLoading && !data ? (
          <TableRowsSkeleton
            rows={6}
            cols={[
              { width: 80 },
              { width: 40 },
              { flex: 1 },
              { width: 80 },
              { width: 80 },
            ]}
          />
        ) : activeTab === 'issues' && issuesLoading && !issuesData ? (
          <TableRowsSkeleton
            rows={6}
            cols={[
              { width: 80 },
              { width: 40 },
              { flex: 1 },
              { width: 80 },
              { width: 80 },
            ]}
          />
        ) : activeTab === 'pulls' && !isLoading && !isError && pulls.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center', color: 'var(--fg-muted)' }}>
            No cached pull requests by {login} in this repo.
          </Box>
        ) : activeTab === 'issues' && !issuesLoading && !issuesError && issues.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center', color: 'var(--fg-muted)' }}>
            No cached issues by {login} in this repo.
          </Box>
        ) : activeTab === 'issues' ? (
          <Box as="table" sx={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 0 }}>
            <Box as="thead" sx={{ position: 'sticky', top: 0, bg: 'var(--bg-subtle)', zIndex: 1 }}>
              <Box as="tr">
                <Box as="th" sx={{ ...tableHeaderSx, width: 104 }}>State</Box>
                <Box as="th" sx={{ ...tableHeaderSx, width: 48 }}>No</Box>
                <Box as="th" sx={tableHeaderSx}>Issue</Box>
                <Box as="th" sx={{ ...tableHeaderSx, width: 92 }}>Opened</Box>
                <Box as="th" sx={{ ...tableHeaderSx, width: 104 }}>Updated</Box>
              </Box>
            </Box>
            <Box as="tbody">
              {issues.map((issue, index) => (
                <Box
                  as="tr"
                  key={issue.id}
                  onClick={() => onIssueClick(issue)}
                  sx={{
                    height: 44,
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
                    {(safeIssuesPage - 1) * AUTHOR_PAGE_SIZE + index + 1}
                  </Box>
                  <Box as="td" sx={{ ...tableCellSx, minWidth: 0, overflow: 'hidden' }}>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, minWidth: 0 }}>
                      <Text
                        sx={{
                          color: 'var(--fg-default)',
                          fontWeight: 500,
                          lineHeight: '20px',
                          minWidth: 0,
                          flex: '1 1 auto',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
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
                  <Box as="td" sx={tableTimeSx} title={issue.created_at ?? undefined}>
                    <RecentTime iso={issue.created_at} />
                  </Box>
                  <Box as="td" sx={tableTimeSx} title={issue.updated_at ?? undefined}>
                    <RecentTime iso={issue.updated_at} />
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        ) : (
          <Box as="table" sx={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 0 }}>
            <Box as="thead" sx={{ position: 'sticky', top: 0, bg: 'var(--bg-subtle)', zIndex: 1 }}>
              <Box as="tr">
                <Box as="th" sx={{ ...tableHeaderSx, width: 104 }}>State</Box>
                <Box as="th" sx={{ ...tableHeaderSx, width: 48 }}>No</Box>
                <Box as="th" sx={tableHeaderSx}>Pull Request</Box>
                <Box as="th" sx={{ ...tableHeaderSx, width: 92 }}>Opened</Box>
                <Box as="th" sx={{ ...tableHeaderSx, width: 104 }}>Updated</Box>
              </Box>
            </Box>
            <Box as="tbody">
              {pulls.map((pull, index) => (
                <Box
                  as="tr"
                  key={pull.id}
                  onClick={() => onPullClick(pull)}
                  sx={{
                    height: 44,
                    borderBottom: '1px solid',
                    borderColor: 'var(--border-muted)',
                    cursor: 'pointer',
                    '&:hover': { bg: 'var(--bg-subtle)' },
                  }}
                >
                  <Box as="td" sx={tableCellSx}>
                    <PullStatusBadge pr={pull} />
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
                    {(safePullsPage - 1) * AUTHOR_PAGE_SIZE + index + 1}
                  </Box>
                  <Box as="td" sx={{ ...tableCellSx, minWidth: 0, overflow: 'hidden' }}>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, minWidth: 0 }}>
                      <Text
                        sx={{
                          color: 'var(--fg-default)',
                          fontWeight: 500,
                          lineHeight: '20px',
                          minWidth: 0,
                          flex: '1 1 auto',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={pull.title}
                      >
                        {pull.title}
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
                        #{pull.number}
                      </Text>
                    </Box>
                  </Box>
                  <Box as="td" sx={tableTimeSx} title={pull.created_at ?? undefined}>
                    <RecentTime iso={pull.created_at} />
                  </Box>
                  <Box as="td" sx={tableTimeSx} title={pull.updated_at ?? undefined}>
                    <RecentTime iso={pull.updated_at} />
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Box>

      {activeTotalItems > AUTHOR_PAGE_SIZE && (
        <Box
          sx={{
            px: 3,
            py: 2,
            borderTop: '1px solid',
            borderColor: 'var(--border-default)',
            display: 'flex',
            justifyContent: 'flex-end',
            flexShrink: 0,
          }}
        >
          <TablePagination
            page={activePage}
            totalPages={activeTotalPages}
            totalItems={activeTotalItems}
            pageSize={AUTHOR_PAGE_SIZE}
            onChange={activePageSetter}
          />
        </Box>
      )}
    </Box>
  );
}

function AuthorTab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <Box
      as="button"
      type="button"
      onClick={onClick}
      aria-pressed={active}
      sx={{
        position: 'relative',
        px: 0,
        py: 2,
        border: 'none',
        bg: 'transparent',
        color: active ? 'var(--fg-default)' : 'var(--fg-muted)',
        cursor: 'pointer',
        fontSize: 0,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        '&:hover': { color: 'var(--fg-default)' },
        '&::after': {
          content: '""',
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: -1,
          height: 2,
          bg: active ? 'var(--accent-emphasis)' : 'transparent',
          borderRadius: 999,
        },
      }}
    >
      <span>{label}</span>
      <span
        style={{
          minWidth: 18,
          padding: '0 6px',
          borderRadius: 999,
          background: active ? 'var(--accent-subtle)' : 'var(--bg-emphasis)',
          color: active ? 'var(--accent-fg)' : 'var(--fg-muted)',
          fontSize: 11,
          lineHeight: '18px',
          textAlign: 'center',
        }}
      >
        {count}
      </span>
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
