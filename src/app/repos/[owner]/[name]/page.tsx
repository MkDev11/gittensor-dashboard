'use client';

export const dynamic = 'force-dynamic';

import React, { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PageLayout, Heading, Text, Box, Label, UnderlineNav } from '@primer/react';
import {
  ArrowLeftIcon,
  StarIcon,
  StarFillIcon,
  MarkGithubIcon,
  BookIcon,
  CodeIcon,
  IssueOpenedIcon,
  GitPullRequestIcon,
  PeopleIcon,
  ChecklistIcon,
  RepoIcon,
  FileDirectoryIcon,
  FileIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@primer/octicons-react';
import type { Icon } from '@primer/octicons-react';
import Spinner from '@/components/Spinner';
import { SkeletonBar } from '@/components/Skeleton';
import { isTracked as repoIsTracked, useTrackedRepos } from '@/lib/tracked-repos';
import type {
  Issue,
  IssuesResponse,
  GtRepoSummary,
  GtRepoPrsResponse,
  RepoMiner,
  RepoMinersResponse,
} from '@/types/entities';
import { renderMarkdownToHtml } from '@/lib/markdown';
import { formatRelativeTime } from '@/lib/format';

type TabKey = 'readme' | 'code' | 'issues' | 'pulls' | 'contributing' | 'check';

const TABS: { key: TabKey; label: string; icon: Icon }[] = [
  { key: 'readme', label: 'Readme', icon: BookIcon },
  { key: 'code', label: 'Code', icon: CodeIcon },
  { key: 'issues', label: 'Issues', icon: IssueOpenedIcon },
  { key: 'pulls', label: 'Pull Requests', icon: GitPullRequestIcon },
  { key: 'contributing', label: 'Contributing', icon: PeopleIcon },
  { key: 'check', label: 'Repo Check', icon: ChecklistIcon },
];

export default function RepoDetailPage(ctx: { params: Promise<{ owner: string; name: string }> }) {
  const params = use(ctx.params);
  const fullName = `${params.owner}/${params.name}`;
  const { tracked, toggle } = useTrackedRepos();
  const isTracked = repoIsTracked(tracked, fullName);
  const [tab, setTab] = useState<TabKey>('readme');

  const summary = useQuery<GtRepoSummary>({
    queryKey: ['gt-repo', fullName],
    queryFn: async () => {
      const r = await fetch(`/api/gt/repos/${params.owner}/${params.name}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 60_000,
  });

  return (
    <PageLayout containerWidth="xlarge" padding="normal">
      <PageLayout.Header>
        {/* Back link */}
        <Box sx={{ mb: 3 }}>
          <Link href="/repositories" prefetch={false} style={{ textDecoration: 'none' }}>
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                py: '4px',
                border: '1px solid',
                borderColor: 'border.default',
                borderRadius: 1,
                color: 'fg.muted',
                fontSize: 1,
                bg: 'canvas.subtle',
                '&:hover': { color: 'fg.default', borderColor: 'border.muted' },
              }}
            >
              <ArrowLeftIcon size={14} />
              <Text>Back to Repositories</Text>
            </Box>
          </Link>
        </Box>

        {/* Title row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://github.com/${params.owner}.png?size=96`}
            alt={params.owner}
            style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--border-muted)' }}
          />
          <Heading sx={{ fontSize: 5, m: 0, fontFamily: 'mono', fontWeight: 700 }}>
            <Text sx={{ color: 'fg.muted' }}>{params.owner}</Text>
            <Text sx={{ color: 'fg.muted', mx: '2px' }}>/</Text>
            <Text sx={{ color: 'fg.default' }}>{params.name}</Text>
          </Heading>
          <Box
            as="button"
            onClick={() => toggle(fullName)}
            aria-label={isTracked ? 'Untrack' : 'Track'}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              bg: 'transparent',
              border: 'none',
              borderRadius: 1,
              color: isTracked ? 'attention.fg' : 'fg.muted',
              cursor: 'pointer',
              '&:hover': { color: 'attention.fg' },
            }}
          >
            {isTracked ? <StarFillIcon size={18} /> : <StarIcon size={18} />}
          </Box>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            {summary.data?.github && (
              <Chip tone="neutral">{summary.data.github.isPrivate ? 'Private' : 'Public'}</Chip>
            )}
            {isTracked && <Chip tone="success">Tracked</Chip>}
            {summary.data && !summary.data.isActive && <Chip tone="muted">Inactive</Chip>}
          </Box>
          <Box sx={{ ml: 'auto' }}>
            <a
              href={`https://github.com/${fullName}`}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'none' }}
            >
              <Box
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                  px: 3,
                  py: '6px',
                  border: '1px solid',
                  borderColor: 'border.default',
                  borderRadius: 1,
                  color: 'fg.default',
                  bg: 'canvas.subtle',
                  fontSize: 1,
                  fontWeight: 600,
                  '&:hover': { borderColor: 'border.muted', bg: 'canvas.default' },
                }}
              >
                <MarkGithubIcon size={16} />
                <Text sx={{ letterSpacing: '0.5px' }}>VIEW ON GITHUB</Text>
              </Box>
            </a>
          </Box>
        </Box>

        {summary.data?.github?.description && (
          <Text sx={{ color: 'fg.muted', mt: 2, fontSize: 1 }}>{summary.data.github.description}</Text>
        )}

        {/* Tabs */}
        <Box sx={{ mt: 4 }}>
          <UnderlineNav aria-label="Repo sections">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <UnderlineNav.Item
                  key={t.key}
                  icon={Icon}
                  aria-current={tab === t.key ? 'page' : undefined}
                  onSelect={(e: React.SyntheticEvent) => {
                    e.preventDefault();
                    setTab(t.key);
                  }}
                >
                  {t.label}
                </UnderlineNav.Item>
              );
            })}
          </UnderlineNav>
        </Box>
      </PageLayout.Header>

      <PageLayout.Content>
        <Box sx={{ display: ['block', null, 'flex'], gap: 4, alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {tab === 'readme' && <ReadmeTab owner={params.owner} name={params.name} />}
            {tab === 'code' && <CodeTab owner={params.owner} name={params.name} />}
            {tab === 'issues' && <IssuesTab owner={params.owner} name={params.name} />}
            {tab === 'pulls' && <PullsTab owner={params.owner} name={params.name} />}
            {tab === 'contributing' && <ContributingTab owner={params.owner} name={params.name} />}
            {tab === 'check' && <RepoCheckTab owner={params.owner} name={params.name} />}
          </Box>

          <Box sx={{ width: ['100%', null, 320], flexShrink: 0, position: ['static', null, 'sticky'], top: 'calc(var(--header-height) + 16px)', display: 'flex', flexDirection: 'column', gap: 4, mt: [4, null, 0] }}>
            <SidebarSection title="Repository Stats">
              <KvRow label="Weight" value={summary.data?.weight != null ? summary.data.weight.toFixed(2) : '—'} />
              <KvRow label="Total Score" value={fmtScore(summary.data?.totalScore)} />
              <KvRow label="Merged PRs" value={summary.data ? summary.data.mergedPrCount : '—'} />
              <KvStatusRow
                label="Issue Discovery"
                value={summary.data ? (summary.data.issueDiscoveryEnabled ? 'Enabled' : 'Disabled') : '—'}
                tone={summary.data?.issueDiscoveryEnabled ? 'success' : 'muted'}
              />
              <KvRow label="Closed Issues" value={summary.data ? summary.data.closedIssueCount : '—'} />
              <KvSubRow label="Completed" value={summary.data?.completedIssueCount ?? '—'} />
              <KvSubRow label="Closed" value={summary.data?.otherClosedIssueCount ?? '—'} />
            </SidebarSection>

            <TopMinersCard owner={params.owner} name={params.name} />
          </Box>
        </Box>
      </PageLayout.Content>
    </PageLayout>
  );
}

function fmtScore(n: number | undefined): string {
  if (n == null) return '—';
  if (n === 0) return '0';
  if (n < 1) return n.toFixed(2);
  if (n < 100) return n.toFixed(1);
  return Math.round(n).toString();
}

function Chip({ tone, children }: { tone: 'neutral' | 'success' | 'muted'; children: React.ReactNode }) {
  const styles = {
    neutral: { bg: 'transparent', fg: 'fg.muted', border: 'border.default' },
    success: { bg: 'success.subtle', fg: 'success.fg', border: 'success.muted' },
    muted: { bg: 'transparent', fg: 'fg.muted', border: 'border.default' },
  } as const;
  const s = styles[tone];
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 2,
        py: '2px',
        borderRadius: 999,
        border: '1px solid',
        borderColor: s.border,
        bg: s.bg,
        color: s.fg,
        fontSize: 0,
        fontWeight: 600,
      }}
    >
      {children}
    </Box>
  );
}

function SidebarSection({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Heading sx={{ fontSize: 2, fontWeight: 700, m: 0 }}>{title}</Heading>
        {right}
      </Box>
      <Box sx={{ borderTop: '1px solid', borderColor: 'border.default', pt: 2 }}>{children}</Box>
    </Box>
  );
}

function KvRow({ label, value }: { label: string; value: string | number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: '6px' }}>
      <Text sx={{ color: 'fg.default', fontSize: 1 }}>{label}</Text>
      <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'fg.default' }}>{value}</Text>
    </Box>
  );
}

function KvSubRow({ label, value }: { label: string; value: string | number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: '3px', pl: 3 }}>
      <Text sx={{ color: 'fg.muted', fontSize: 0 }}>{label}</Text>
      <Text sx={{ fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'fg.muted', fontSize: 0 }}>{value}</Text>
    </Box>
  );
}

function KvStatusRow({ label, value, tone }: { label: string; value: string; tone: 'success' | 'muted' }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: '5px' }}>
      <Text sx={{ color: 'fg.default', fontWeight: 600 }}>{label}</Text>
      <Label variant={tone === 'success' ? 'success' : 'secondary'}>{value}</Label>
    </Box>
  );
}

// ─── Readme tab ──────────────────────────────────────────────────────────────

function ReadmeTab({ owner, name }: { owner: string; name: string }) {
  const { data, isLoading, isError } = useQuery<{ content: string | null; missing?: boolean }>({
    queryKey: ['gt-repo-readme', owner, name],
    queryFn: async () => {
      const r = await fetch(`/api/gt/repos/${owner}/${name}/readme`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
  const html = useMemo(
    () => (data?.content ? renderMarkdownToHtml(data.content, { repoFullName: `${owner}/${name}` }) : ''),
    [data, name, owner]
  );
  if (isLoading) return <PanelLoading />;
  if (isError) return <PanelError message="Failed to load README." />;
  if (!data?.content) return <PanelEmpty title="No README" message="This repository doesn't have a README file." />;
  return (
    <Panel>
      <Box className="md-content" sx={{ p: 4 }} dangerouslySetInnerHTML={{ __html: html }} />
    </Panel>
  );
}

// ─── Contributing tab ────────────────────────────────────────────────────────

function ContributingTab({ owner, name }: { owner: string; name: string }) {
  const { data, isLoading, isError } = useQuery<{ content: string | null; path?: string; missing?: boolean }>({
    queryKey: ['gt-repo-contributing', owner, name],
    queryFn: async () => {
      const r = await fetch(`/api/gt/repos/${owner}/${name}/contributing`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
  const html = useMemo(
    () => (data?.content ? renderMarkdownToHtml(data.content, { repoFullName: `${owner}/${name}` }) : ''),
    [data, name, owner]
  );
  if (isLoading) return <PanelLoading />;
  if (isError) return <PanelError message="Failed to load contributing guide." />;
  if (!data?.content) return <PanelEmpty title="No contributing guide" message="This repository doesn't have a CONTRIBUTING.md." />;
  return (
    <Panel>
      <Box className="md-content" sx={{ p: 4 }} dangerouslySetInnerHTML={{ __html: html }} />
    </Panel>
  );
}

// ─── Issues tab ──────────────────────────────────────────────────────────────

type IssueFilter = 'all' | 'open' | 'closed';

function IssuesTab({ owner, name }: { owner: string; name: string }) {
  const [filter, setFilter] = useState<IssueFilter>('all');

  const issuesQ = useQuery<IssuesResponse>({
    queryKey: ['gt-detail-issues', owner, name],
    queryFn: async () => {
      const r = await fetch(`/api/repos/${owner}/${name}/issues`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
  });
  const prsQ = useQuery<Pick<GtRepoPrsResponse, 'prs'>>({
    queryKey: ['gt-repo-prs', owner, name],
    queryFn: async () => {
      const r = await fetch(`/api/gt/repos/${owner}/${name}/prs`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
  });

  // Map issue# → PR# via gittensor convention (PR title starts with `#issueNum …`).
  const linkedPrByIssue = useMemo(() => {
    const map = new Map<number, number>();
    for (const p of prsQ.data?.prs ?? []) {
      if (p.linkedIssueNumber != null && !map.has(p.linkedIssueNumber)) {
        map.set(p.linkedIssueNumber, p.pullRequestNumber);
      }
    }
    return map;
  }, [prsQ.data]);

  const counts = useMemo(() => {
    const issues = issuesQ.data?.issues ?? [];
    const open = issues.filter((i) => i.state === 'open').length;
    return { all: issues.length, open, closed: issues.length - open };
  }, [issuesQ.data]);

  const rows: Issue[] = useMemo(() => {
    const issues = issuesQ.data?.issues ?? [];
    return issues.filter((i) => {
      if (filter === 'open') return i.state === 'open';
      if (filter === 'closed') return i.state !== 'open';
      return true;
    });
  }, [issuesQ.data, filter]);

  if (issuesQ.isLoading) return <PanelLoading />;
  if (issuesQ.isError) return <PanelError message="Failed to load issues." />;

  return (
    <Panel>
      <Box
        sx={{
          p: 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 3,
          borderBottom: '1px solid',
          borderColor: 'border.default',
          flexWrap: 'wrap',
        }}
      >
        <Heading sx={{ fontSize: 3, fontWeight: 700, m: 0 }}>
          Issues <Text sx={{ color: 'fg.muted', fontWeight: 400 }}>({counts.all})</Text>
        </Heading>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
          <FilterPill active={filter === 'all'} onClick={() => setFilter('all')} label="All" count={counts.all} />
          <FilterPill active={filter === 'open'} onClick={() => setFilter('open')} label="Open" count={counts.open} />
          <FilterPill active={filter === 'closed'} onClick={() => setFilter('closed')} label="Closed" count={counts.closed} />
        </Box>
      </Box>

      <Box as="table" sx={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 1 }}>
        <Box as="thead" sx={{ bg: 'canvas.subtle', borderBottom: '1px solid', borderColor: 'border.default' }}>
          <Box as="tr">
            <ColTh>ISSUE #</ColTh>
            <ColTh>TITLE</ColTh>
            <ColTh>STATUS</ColTh>
            <ColTh>LINKED PR</ColTh>
            <ColTh>CREATED</ColTh>
            <ColTh align="right">CLOSED</ColTh>
          </Box>
        </Box>
        <Box as="tbody">
          {rows.length === 0 && (
            <Box as="tr">
              <Box as="td" colSpan={6} sx={{ p: 4, textAlign: 'center', color: 'fg.muted' }}>
                No issues match.
              </Box>
            </Box>
          )}
          {rows.map((it) => {
            const closed = it.state !== 'open';
            const linkedPr = linkedPrByIssue.get(it.number);
            return (
              <Box as="tr" key={it.id} sx={rowSx}>
                <Box as="td" sx={cellSx}>
                  <a href={it.html_url ?? '#'} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                    <Text sx={{ fontFamily: 'mono', color: 'fg.default', '&:hover': { color: 'accent.fg' } }}>
                      #{it.number}
                    </Text>
                  </a>
                </Box>
                <Box as="td" sx={{ ...cellSx, maxWidth: 0 }}>
                  <a href={it.html_url ?? '#'} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }} title={it.title}>
                    <Text sx={{ fontFamily: 'mono', color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', '&:hover': { color: 'accent.fg' } }}>
                      {it.title}
                    </Text>
                  </a>
                </Box>
                <Box as="td" sx={cellSx}>
                  <StatePill kind={closed ? 'closed-issue' : 'open-issue'} />
                </Box>
                <Box as="td" sx={cellSx}>
                  {linkedPr ? (
                    <a
                      href={`https://github.com/${owner}/${name}/pull/${linkedPr}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--accent-fg)', textDecoration: 'none', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
                    >
                      #{linkedPr}
                    </a>
                  ) : (
                    <Text sx={{ color: 'fg.muted' }}>—</Text>
                  )}
                </Box>
                <Box as="td" sx={cellSx}>
                  <Text sx={{ fontFamily: 'mono', color: 'fg.default' }}>{fmtShortDate(it.created_at)}</Text>
                </Box>
                <Box as="td" sx={{ ...cellSx, textAlign: 'right' }}>
                  <Text sx={{ fontFamily: 'mono', color: it.closed_at ? 'fg.default' : 'fg.muted' }}>
                    {it.closed_at ? fmtShortDate(it.closed_at) : '—'}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Panel>
  );
}

// ─── Pull Requests tab ───────────────────────────────────────────────────────

type PrFilter = 'all' | 'open' | 'merged' | 'closed';
type PrSortKey = 'score' | 'commits' | 'changes' | 'created' | 'merged' | 'number';

function PullsTab({ owner, name }: { owner: string; name: string }) {
  const [filter, setFilter] = useState<PrFilter>('all');
  const [sortKey, setSortKey] = useState<PrSortKey>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const { data, isLoading, isError } = useQuery<GtRepoPrsResponse>({
    queryKey: ['gt-repo-prs', owner, name],
    queryFn: async () => {
      const r = await fetch(`/api/gt/repos/${owner}/${name}/prs`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const onSort = (k: PrSortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('desc'); }
  };

  const rows = useMemo(() => {
    const all = data?.prs ?? [];
    const filtered = all.filter((p) => {
      if (filter === 'open') return p.prState === 'OPEN';
      if (filter === 'merged') return p.prState === 'MERGED';
      if (filter === 'closed') return p.prState === 'CLOSED';
      return true;
    });
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'score') cmp = a.score - b.score;
      else if (sortKey === 'commits') cmp = a.commitCount - b.commitCount;
      else if (sortKey === 'changes') cmp = (a.additions + a.deletions) - (b.additions + b.deletions);
      else if (sortKey === 'created') cmp = (Date.parse(a.prCreatedAt) || 0) - (Date.parse(b.prCreatedAt) || 0);
      else if (sortKey === 'merged') cmp = (a.mergedAt ? Date.parse(a.mergedAt) : 0) - (b.mergedAt ? Date.parse(b.mergedAt) : 0);
      else if (sortKey === 'number') cmp = a.pullRequestNumber - b.pullRequestNumber;
      if (cmp === 0) cmp = b.pullRequestNumber - a.pullRequestNumber;
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [data, filter, sortKey, sortDir]);

  if (isLoading) return <PanelLoading />;
  if (isError) return <PanelError message="Failed to load pull requests." />;

  const counts = data?.counts ?? { all: 0, open: 0, merged: 0, closed: 0 };

  return (
    <Panel>
      <Box
        sx={{
          p: 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 3,
          borderBottom: '1px solid',
          borderColor: 'border.default',
          flexWrap: 'wrap',
        }}
      >
        <Heading sx={{ fontSize: 3, fontWeight: 700, m: 0 }}>
          Pull Requests <Text sx={{ color: 'fg.muted', fontWeight: 400 }}>({counts.all})</Text>
        </Heading>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
          <FilterPill active={filter === 'all'} onClick={() => setFilter('all')} label="All" count={counts.all} />
          <FilterPill active={filter === 'open'} onClick={() => setFilter('open')} label="Open" count={counts.open} />
          <FilterPill active={filter === 'merged'} onClick={() => setFilter('merged')} label="Merged" count={counts.merged} />
          <FilterPill active={filter === 'closed'} onClick={() => setFilter('closed')} label="Closed" count={counts.closed} />
        </Box>
      </Box>

      <Box as="table" sx={{ width: '100%', minWidth: 920, borderCollapse: 'collapse', fontSize: 1 }}>
        <Box as="thead" sx={{ bg: 'canvas.subtle', borderBottom: '1px solid', borderColor: 'border.default' }}>
          <Box as="tr">
            <SortableTh sk="number" current={sortKey} dir={sortDir} onSort={onSort}>PR #</SortableTh>
            <ColTh>TITLE</ColTh>
            <ColTh>AUTHOR</ColTh>
            <SortableTh sk="commits" current={sortKey} dir={sortDir} onSort={onSort} align="right">COMMITS</SortableTh>
            <SortableTh sk="changes" current={sortKey} dir={sortDir} onSort={onSort} align="right">+/-</SortableTh>
            <SortableTh sk="score" current={sortKey} dir={sortDir} onSort={onSort} align="right">SCORE</SortableTh>
            <ColTh align="left">STATUS</ColTh>
            <SortableTh sk="merged" current={sortKey} dir={sortDir} onSort={onSort} align="right">MERGED</SortableTh>
          </Box>
        </Box>
        <Box as="tbody">
          {rows.length === 0 && (
            <Box as="tr">
              <Box as="td" colSpan={8} sx={{ p: 4, textAlign: 'center', color: 'fg.muted' }}>
                No pull requests match.
              </Box>
            </Box>
          )}
          {rows.map((p) => {
            const url = `https://github.com/${owner}/${name}/pull/${p.pullRequestNumber}`;
            return (
              <Box as="tr" key={p.pullRequestNumber} sx={rowSx}>
                <Box as="td" sx={cellSx}>
                  <a href={url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                    <Text sx={{ fontFamily: 'mono', color: 'fg.default', '&:hover': { color: 'accent.fg' } }}>
                      #{p.pullRequestNumber}
                    </Text>
                  </a>
                </Box>
                <Box as="td" sx={{ ...cellSx, maxWidth: 0 }}>
                  <a href={url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }} title={p.title}>
                    <Text sx={{ fontFamily: 'mono', color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', '&:hover': { color: 'accent.fg' } }}>
                      {p.title}
                    </Text>
                  </a>
                </Box>
                <Box as="td" sx={cellSx}>
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.avatarUrl}
                      alt={p.author}
                      loading="lazy"
                      style={{ width: 20, height: 20, borderRadius: '50%', border: '1px solid var(--border-muted)' }}
                    />
                    <Text sx={{ fontFamily: 'mono', color: 'fg.default' }}>{p.author}</Text>
                  </Box>
                </Box>
                <Box as="td" sx={{ ...cellSx, textAlign: 'right' }}>
                  <Text sx={{ fontFamily: 'mono', color: 'fg.default', fontVariantNumeric: 'tabular-nums' }}>
                    {p.commitCount}
                  </Text>
                </Box>
                <Box as="td" sx={{ ...cellSx, textAlign: 'right' }}>
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, fontFamily: 'mono', fontVariantNumeric: 'tabular-nums' }}>
                    <Text sx={{ color: 'success.fg' }}>+{p.additions}</Text>
                    <Text sx={{ color: 'danger.fg' }}>-{p.deletions}</Text>
                  </Box>
                </Box>
                <Box as="td" sx={{ ...cellSx, textAlign: 'right' }}>
                  <Text sx={{ fontFamily: 'mono', color: p.score > 0 ? 'fg.default' : 'fg.muted', fontVariantNumeric: 'tabular-nums', fontWeight: p.score > 0 ? 600 : 400 }}>
                    {p.score.toFixed(4)}
                  </Text>
                </Box>
                <Box as="td" sx={cellSx}>
                  <StatePill kind={p.prState === 'MERGED' ? 'merged-pr' : p.prState === 'CLOSED' ? 'closed-pr' : 'open-pr'} />
                </Box>
                <Box as="td" sx={{ ...cellSx, textAlign: 'right' }}>
                  <Text sx={{ fontFamily: 'mono', color: p.mergedAt ? 'fg.default' : 'fg.muted' }}>
                    {p.mergedAt ? fmtShortDate(p.mergedAt) : '—'}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Panel>
  );
}

// ─── Shared bits for the issue/PR tables ─────────────────────────────────────

const rowSx = {
  borderBottom: '1px solid',
  borderColor: 'border.muted',
  '&:hover': { bg: 'canvas.subtle' },
  '&:last-child': { borderBottom: 'none' },
};

const cellSx = {
  px: 3,
  py: 2,
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
} as const;

function ColTh({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <Box
      as="th"
      sx={{
        px: 3,
        py: 2,
        textAlign: align,
        fontWeight: 600,
        fontSize: '11px',
        color: 'fg.muted',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}

function SortableTh({
  children,
  sk,
  current,
  dir,
  onSort,
  align = 'left',
}: {
  children: React.ReactNode;
  sk: PrSortKey;
  current: PrSortKey;
  dir: 'asc' | 'desc';
  onSort: (k: PrSortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = current === sk;
  return (
    <Box
      as="th"
      onClick={() => onSort(sk)}
      sx={{
        px: 3,
        py: 2,
        textAlign: align,
        fontWeight: 600,
        fontSize: '11px',
        color: active ? 'fg.default' : 'fg.muted',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        userSelect: 'none',
        '&:hover': { color: 'fg.default' },
      }}
    >
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
        {active && (dir === 'desc' ? <Triangle dir="down" /> : <Triangle dir="up" />)}
        {children}
      </Box>
    </Box>
  );
}

function Triangle({ dir }: { dir: 'up' | 'down' }) {
  return (
    <Box as="span" sx={{ display: 'inline-flex', color: 'fg.default' }}>
      <svg width="10" height="10" viewBox="0 0 10 10">
        {dir === 'down' ? <polygon points="2,3 8,3 5,8" fill="currentColor" /> : <polygon points="5,2 8,7 2,7" fill="currentColor" />}
      </svg>
    </Box>
  );
}

function FilterPill({
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
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: '4px',
        bg: active ? 'canvas.default' : 'transparent',
        border: '1px solid',
        borderColor: active ? 'border.default' : 'transparent',
        borderRadius: 1,
        color: active ? 'fg.default' : 'fg.muted',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: 1,
        fontWeight: active ? 600 : 500,
        '&:hover': { color: 'fg.default' },
      }}
    >
      <Text>{label}</Text>
      <Text sx={{ color: 'fg.muted', fontWeight: 500, fontFamily: 'mono', fontVariantNumeric: 'tabular-nums' }}>{count}</Text>
    </Box>
  );
}

type PillKind = 'open-issue' | 'closed-issue' | 'open-pr' | 'merged-pr' | 'closed-pr';
function StatePill({ kind }: { kind: PillKind }) {
  const conf: Record<PillKind, { label: string; bg: string; fg: string; border: string; dotColor: string }> = {
    'open-issue': { label: 'OPEN', bg: 'transparent', fg: 'fg.default', border: 'border.default', dotColor: 'fg.muted' },
    'closed-issue': { label: 'CLOSED', bg: 'success.subtle', fg: 'success.fg', border: 'success.muted', dotColor: 'success.emphasis' },
    'open-pr': { label: 'OPEN', bg: 'transparent', fg: 'fg.default', border: 'border.default', dotColor: 'fg.muted' },
    'merged-pr': { label: 'MERGED', bg: 'success.subtle', fg: 'success.fg', border: 'success.muted', dotColor: 'success.emphasis' },
    'closed-pr': { label: 'CLOSED', bg: 'danger.subtle', fg: 'danger.fg', border: 'danger.muted', dotColor: 'danger.emphasis' },
  };
  const c = conf[kind];
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: '2px',
        bg: c.bg,
        border: '1px solid',
        borderColor: c.border,
        color: c.fg,
        borderRadius: 999,
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.5px',
      }}
    >
      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bg: c.dotColor }} />
      {c.label}
    </Box>
  );
}

function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ─── Code tab ────────────────────────────────────────────────────────────────

interface CodeItem {
  name: string;
  path: string;
  type: 'dir' | 'file' | string;
  size: number;
  htmlUrl: string;
}

interface DirResp {
  isFile: false;
  items: CodeItem[];
  path: string;
  lastCommit: { sha: string; message: string; author: string; committedAt: string } | null;
  missing?: boolean;
}

interface FileResp {
  isFile: true;
  path: string;
  name: string;
  size: number;
  sha: string;
  htmlUrl: string | null;
  downloadUrl: string | null;
  content: string | null;
  isBinary: boolean;
  truncated: boolean;
  missing?: boolean;
}

type ContentsResp = DirResp | FileResp;

function CodeTab({ owner, name }: { owner: string; name: string }) {
  const [path, setPath] = useState('');
  const { data, isLoading, isError } = useQuery<ContentsResp>({
    queryKey: ['gt-repo-contents', owner, name, path],
    queryFn: async () => {
      const r = await fetch(`/api/gt/repos/${owner}/${name}/contents?path=${encodeURIComponent(path)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
  if (isLoading) return <PanelLoading />;
  if (isError) return <PanelError message="Failed to load." />;

  const segments = path ? path.split('/') : [];
  const breadcrumbs = [
    { label: `${owner}/${name}`, target: '' },
    ...segments.map((seg, i) => ({ label: seg, target: segments.slice(0, i + 1).join('/') })),
  ];

  return (
    <Panel>
      <Box sx={{ p: 3, borderBottom: '1px solid', borderColor: 'border.default', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        {breadcrumbs.map((b, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Text sx={{ color: 'fg.muted' }}>/</Text>}
            <Box
              as="button"
              onClick={() => setPath(b.target)}
              sx={{
                bg: 'transparent',
                border: 'none',
                p: 0,
                color: i === breadcrumbs.length - 1 ? 'fg.default' : 'accent.fg',
                cursor: 'pointer',
                fontFamily: 'mono',
                fontSize: 1,
                fontWeight: i === breadcrumbs.length - 1 ? 700 : 500,
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              {b.label}
            </Box>
          </React.Fragment>
        ))}
      </Box>

      {data && data.isFile ? (
        <FileView file={data} />
      ) : (
        <DirView dir={data as DirResp} onOpen={(p) => setPath(p)} />
      )}
    </Panel>
  );
}

function DirView({ dir, onOpen }: { dir: DirResp; onOpen: (path: string) => void }) {
  return (
    <>
      {dir?.lastCommit && (
        <Box sx={{ p: 3, borderBottom: '1px solid', borderColor: 'border.default', display: 'flex', alignItems: 'center', gap: 2, fontSize: 1, color: 'fg.muted', bg: 'canvas.subtle' }}>
          <Text sx={{ fontWeight: 600, color: 'fg.default' }}>{dir.lastCommit.author}</Text>
          <Text sx={{ fontFamily: 'mono', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {dir.lastCommit.message}
          </Text>
          <Text sx={{ fontFamily: 'mono', flexShrink: 0 }}>{dir.lastCommit.sha}</Text>
          <Text sx={{ flexShrink: 0 }}>{dir.lastCommit.committedAt && formatRelativeTime(dir.lastCommit.committedAt)}</Text>
        </Box>
      )}

      <Box>
        {dir?.items?.map((it) => (
          <Box
            key={it.path}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              px: 3,
              py: 2,
              borderBottom: '1px solid',
              borderColor: 'border.muted',
              '&:last-child': { borderBottom: 'none' },
              '&:hover': { bg: 'canvas.subtle' },
              cursor: 'pointer',
            }}
            onClick={() => onOpen(it.path)}
          >
            <Box sx={{ color: it.type === 'dir' ? 'accent.fg' : 'fg.muted', display: 'inline-flex' }}>
              {it.type === 'dir' ? <FileDirectoryIcon size={16} /> : <FileIcon size={16} />}
            </Box>
            <Text sx={{ fontFamily: 'mono', fontSize: 1, color: 'fg.default', flex: 1 }}>{it.name}</Text>
            {it.type === 'file' && it.size > 0 && (
              <Text sx={{ color: 'fg.muted', fontSize: 0 }}>{fmtBytes(it.size)}</Text>
            )}
          </Box>
        ))}
        {(!dir?.items || dir.items.length === 0) && (
          <Box sx={{ p: 4, textAlign: 'center', color: 'fg.muted' }}>This directory is empty.</Box>
        )}
      </Box>
    </>
  );
}

function FileView({ file }: { file: FileResp }) {
  if (file.missing) {
    return <Box sx={{ p: 4, textAlign: 'center', color: 'fg.muted' }}>File not found.</Box>;
  }
  if (file.isBinary) {
    return (
      <Box sx={{ p: 4, textAlign: 'center', color: 'fg.muted' }}>
        Binary file —{' '}
        {file.downloadUrl ? (
          <a href={file.downloadUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-fg)' }}>
            download
          </a>
        ) : (
          'unable to display'
        )}
        .
      </Box>
    );
  }
  if (file.truncated || file.content == null) {
    return (
      <Box sx={{ p: 4, textAlign: 'center', color: 'fg.muted' }}>
        File too large to display inline ({fmtBytes(file.size)}).{' '}
        {file.htmlUrl && (
          <a href={file.htmlUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-fg)' }}>
            View on GitHub
          </a>
        )}
      </Box>
    );
  }

  const lines = file.content.split('\n');
  // GitHub strips a single trailing newline before showing line numbers.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();

  return (
    <Box
      sx={{
        fontFamily: 'mono',
        fontSize: '12px',
        lineHeight: '20px',
        overflowX: 'auto',
        bg: 'canvas.default',
      }}
    >
      <Box as="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
        <Box as="tbody">
          {lines.map((line, i) => (
            <Box as="tr" key={i}>
              <Box
                as="td"
                sx={{
                  textAlign: 'right',
                  color: 'fg.subtle',
                  userSelect: 'none',
                  px: 3,
                  py: 0,
                  width: '1%',
                  whiteSpace: 'nowrap',
                  borderRight: '1px solid',
                  borderColor: 'border.muted',
                  verticalAlign: 'top',
                }}
              >
                {i + 1}
              </Box>
              <Box
                as="td"
                sx={{
                  px: 3,
                  py: 0,
                  whiteSpace: 'pre',
                  color: 'fg.default',
                  verticalAlign: 'top',
                }}
              >
                {line || '​'}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Repo Check tab ──────────────────────────────────────────────────────────

interface HealthResp {
  healthPercentage: number;
  openIssues: number;
  forks: number;
  stars: number;
  goodFirstIssues: number;
  helpWanted: number;
  pushedAt: string | null;
  createdAt: string | null;
  isArchived: boolean;
  standards: {
    license: boolean;
    readme: boolean;
    contributing: boolean;
    codeOfConduct: boolean;
    pullRequestTemplate: boolean;
    issueTemplates: boolean;
    securityPolicy: boolean;
  };
}

function RepoCheckTab({ owner, name }: { owner: string; name: string }) {
  const { data, isLoading, isError } = useQuery<HealthResp>({
    queryKey: ['gt-repo-health', owner, name],
    queryFn: async () => {
      const r = await fetch(`/api/gt/repos/${owner}/${name}/health`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
  if (isLoading) return <PanelLoading />;
  if (isError || !data) return <PanelError message="Failed to load repository health." />;

  const standardsList: { key: keyof HealthResp['standards']; label: string; desc: string }[] = [
    { key: 'license', label: 'License', desc: 'Repository has a license file.' },
    { key: 'readme', label: 'README', desc: 'Repository has a README file.' },
    { key: 'contributing', label: 'Contributing Guidelines', desc: 'Guidelines for new contributors.' },
    { key: 'codeOfConduct', label: 'Code of Conduct', desc: 'Standards for community behavior.' },
    { key: 'pullRequestTemplate', label: 'Pull Request Template', desc: 'Template for new pull requests.' },
    { key: 'issueTemplates', label: 'Issue Templates', desc: 'Templates for reporting issues.' },
    { key: 'securityPolicy', label: 'Security Policy', desc: 'Security policy for vulnerability reporting.' },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Heading sx={{ fontSize: 4, mb: 1 }}>Repository Health Check & Feasibility</Heading>
        <Text sx={{ color: 'fg.muted' }}>
          An in-depth analysis of the repository&apos;s openness to contributions, code health, and community standards.
        </Text>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', '1fr 2fr'], gap: 3 }}>
        <HealthScoreCard pct={data.healthPercentage} />
        <Panel>
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
              <IssueOpenedIcon size={16} />
              <Heading sx={{ fontSize: 2, fontWeight: 700, m: 0 }}>Issue Analysis</Heading>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2 }}>
              <CountBox label="Open Issues" value={data.openIssues} />
              <CountBox label="Forks" value={data.forks} />
              <CountBox label="Good First Issues" value={data.goodFirstIssues} hint="Perfect for beginners" />
              <CountBox label="Help Wanted" value={data.helpWanted} hint="General contributions" />
            </Box>
          </Box>
        </Panel>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', '1fr 2fr'], gap: 3 }}>
        <Panel>
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
              <RepoIcon size={16} />
              <Heading sx={{ fontSize: 2, fontWeight: 700, m: 0 }}>Activity & Feasibility</Heading>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FactRow label="Last Push" value={data.pushedAt ? formatDate(data.pushedAt) : '—'} />
              <FactRow label="Created" value={data.createdAt ? formatDate(data.createdAt) : '—'} />
              <FactRow
                label="Status"
                value={
                  <Chip tone={data.isArchived ? 'muted' : 'success'}>
                    {data.isArchived ? 'ARCHIVED' : 'ACTIVE'}
                  </Chip>
                }
              />
            </Box>
          </Box>
        </Panel>
        <Panel>
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
              <PeopleIcon size={16} />
              <Heading sx={{ fontSize: 2, fontWeight: 700, m: 0 }}>Community Standards</Heading>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', '1fr 1fr'], gap: 2 }}>
              {standardsList.map((s) => (
                <StandardRow key={s.key} present={data.standards[s.key]} label={s.label} desc={s.desc} />
              ))}
            </Box>
          </Box>
        </Panel>
      </Box>
    </Box>
  );
}

function FactRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: '4px' }}>
      <Text sx={{ color: 'fg.muted', fontSize: 1 }}>{label}</Text>
      <Box sx={{ fontFamily: 'mono', fontWeight: 600 }}>{value}</Box>
    </Box>
  );
}

function HealthScoreCard({ pct }: { pct: number }) {
  const r = 50;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(1, pct / 100)));
  const stroke = pct >= 75 ? 'var(--success-emphasis)' : pct >= 50 ? 'var(--attention-emphasis)' : 'var(--danger-fg)';
  return (
    <Panel>
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        <Box sx={{ position: 'relative', width: 120, height: 120 }}>
          <svg width="120" height="120" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r={r} stroke="var(--border-default)" strokeWidth="8" fill="none" />
            <circle
              cx="60"
              cy="60"
              r={r}
              stroke={stroke}
              strokeWidth="8"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={offset}
              transform="rotate(-90 60 60)"
            />
          </svg>
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 5,
              fontWeight: 700,
              color: stroke,
              fontFamily: 'mono',
            }}
          >
            {pct}%
          </Box>
        </Box>
        <Text sx={{ fontSize: 2, fontWeight: 600 }}>Health Score</Text>
        <Text sx={{ color: 'fg.muted', fontSize: 0, textAlign: 'center' }}>
          Based on community standards and best practices.
        </Text>
      </Box>
    </Panel>
  );
}

function CountBox({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 2 }}>
      <Text sx={{ display: 'block', fontSize: 4, fontWeight: 700, color: 'fg.default', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums' }}>
        {value.toLocaleString()}
      </Text>
      <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted', fontWeight: 600 }}>{label}</Text>
      {hint && <Text sx={{ display: 'block', fontSize: 0, color: 'fg.subtle' }}>{hint}</Text>}
    </Box>
  );
}

function StandardRow({ present, label, desc }: { present: boolean; label: string; desc: string }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 2,
        p: 2,
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
      }}
    >
      <Box sx={{ color: present ? 'success.fg' : 'danger.fg', mt: '2px' }}>
        {present ? <CheckCircleIcon size={16} /> : <XCircleIcon size={16} />}
      </Box>
      <Box>
        <Text sx={{ fontSize: 1, fontWeight: 600, color: 'fg.default' }}>{label}</Text>
        <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>{desc}</Text>
      </Box>
    </Box>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Top Miner Contributors sidebar card ─────────────────────────────────────

function TopMinersCard({ owner, name }: { owner: string; name: string }) {
  const [tab, setTab] = useState<'oss' | 'issue'>('oss');
  const { data, isLoading, isError, error } = useQuery<RepoMinersResponse>({
    queryKey: ['gt-repo-miners', owner, name],
    queryFn: async () => {
      const r = await fetch(`/api/gt/repos/${owner}/${name}/miners`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 60_000,
  });
  const ossCount = data?.ossContributions?.length ?? 0;
  const issueCount = data?.issueDiscoveries?.length ?? 0;
  const rows = (tab === 'oss' ? data?.ossContributions : data?.issueDiscoveries) ?? [];
  const otherCount = tab === 'oss' ? issueCount : ossCount;
  const total = rows.length;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Heading sx={{ fontSize: 2, fontWeight: 700, m: 0 }}>
          Top Miner Contributors{' '}
          <Text sx={{ color: 'fg.muted', fontWeight: 400 }}>({total})</Text>
        </Heading>
      </Box>
      <Box sx={{ borderTop: '1px solid', borderColor: 'border.default', pt: 2 }}>
        <Box
          role="tablist"
          aria-label="Miner contributor score type"
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            mb: 2,
            borderBottom: '1px solid',
            borderColor: 'border.default',
          }}
        >
          <MinerTabBtn active={tab === 'oss'} count={ossCount} onClick={() => setTab('oss')}>OSS</MinerTabBtn>
          <MinerTabBtn active={tab === 'issue'} count={issueCount} onClick={() => setTab('issue')}>Discovery</MinerTabBtn>
        </Box>
        <Box as="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 1 }}>
          <Box as="thead">
            <Box as="tr">
              <Box as="th" sx={{ textAlign: 'left', fontSize: '10px', color: 'fg.muted', fontWeight: 600, py: '6px', width: 22 }}>#</Box>
              <Box as="th" sx={{ textAlign: 'left', fontSize: '10px', color: 'fg.muted', fontWeight: 600, py: '6px' }}>MINER</Box>
              <Box as="th" sx={{ textAlign: 'right', fontSize: '10px', color: 'fg.muted', fontWeight: 600, py: '6px' }}>{tab === 'oss' ? 'PRS' : 'COMPLETED'}</Box>
              <Box as="th" sx={{ textAlign: 'right', fontSize: '10px', color: 'fg.muted', fontWeight: 600, py: '6px' }}>{tab === 'oss' ? 'REPO SCORE' : 'CLOSED'}</Box>
            </Box>
          </Box>
          <Box as="tbody">
            {isLoading && (
              <Box as="tr">
                <Box as="td" colSpan={4} sx={{ p: 3, textAlign: 'center', color: 'fg.muted' }}>
                  <Spinner size="sm" tone="muted" inline />
                </Box>
              </Box>
            )}
            {isError && (
              <Box as="tr">
                <Box as="td" colSpan={4} sx={{ p: 3, textAlign: 'center', color: 'danger.fg', fontSize: 0 }}>
                  Failed to load miner contributors{error instanceof Error ? ': ' + error.message : ''}
                </Box>
              </Box>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <Box as="tr">
                <Box as="td" colSpan={4} sx={{ p: 3, textAlign: 'center', color: 'fg.muted', fontSize: 0 }}>
                  {emptyMinerMessage(tab, otherCount)}
                </Box>
              </Box>
            )}
            {rows.map((m, i) => (
              <Box as="tr" key={`${m.githubId}-${m.githubUsername}`} sx={{ borderTop: '1px solid', borderColor: 'border.muted' }}>
                <Box as="td" sx={{ py: '8px', color: 'fg.muted', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', verticalAlign: 'top' }}>
                  {i + 1}
                </Box>
                <Box as="td" sx={{ py: '8px' }}>
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={m.avatarUrl}
                      alt={m.githubUsername}
                      loading="lazy"
                      style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--border-muted)' }}
                    />
                    <Box>
                      <Text sx={{ fontWeight: 600, color: 'fg.default', display: 'block' }}>{m.githubUsername}</Text>
                      {tab === 'oss' && m.ossRank != null && (
                        <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>
                          Global #{m.ossRank}{m.globalScore != null ? ` - ${m.globalScore.toFixed(2)}` : ''}
                        </Text>
                      )}
                      {tab === 'issue' && m.reason && (
                        <Text sx={{ display: 'block', fontSize: 0, color: issueReasonColor(m), maxWidth: 155 }}>
                          {m.reason}
                        </Text>
                      )}
                    </Box>
                  </Box>
                </Box>
                <Box as="td" sx={{ py: '8px', textAlign: 'right', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'fg.default', verticalAlign: 'top' }}>
                  {tab === 'oss' ? m.prCount : m.completedIssueCount ?? m.solvedIssueCount ?? 0}
                </Box>
                <Box as="td" sx={{ py: '8px', textAlign: 'right', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: m.score > 0 ? 'fg.default' : 'fg.muted', verticalAlign: 'top' }}>
                  {tab === 'oss' ? m.score.toFixed(2) : m.otherClosedIssueCount ?? Math.max(0, (m.issueCount ?? 0) - (m.completedIssueCount ?? 0))}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function emptyMinerMessage(tab: 'oss' | 'issue', otherCount: number): string {
  if (tab === 'oss') {
    return otherCount > 0 ? `No OSS contributors yet. Issue Discovery has ${otherCount}.` : 'No OSS contributors yet.';
  }
  return otherCount > 0 ? `No issue-discovery candidates yet. OSS Contributions has ${otherCount}.` : 'No issue-discovery candidates yet.';
}

function issueReasonColor(row: RepoMiner): 'success.fg' | 'attention.fg' | 'danger.fg' | 'fg.muted' {
  if ((row.candidateIssueCount ?? 0) > 0) return 'success.fg';
  const reason = (row.reason ?? '').toLowerCase();
  if (reason.includes('owner') || reason.includes('maintainer')) return 'danger.fg';
  if (reason.includes('same author') || reason.includes('first issue')) return 'attention.fg';
  return 'fg.muted';
}

function MinerTabBtn({ active, count, onClick, children }: { active: boolean; count: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <Box
      as="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        minWidth: 0,
        width: '100%',
        px: 2,
        py: '8px',
        mb: '-1px',
        bg: 'transparent',
        color: active ? 'fg.default' : 'fg.muted',
        border: 0,
        borderBottom: '2px solid',
        borderColor: active ? 'accent.emphasis' : 'transparent',
        borderRadius: 0,
        fontSize: '12px',
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'inherit',
        '&:hover': { color: 'fg.default', bg: 'canvas.subtle' },
      }}
    >
      <Text sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</Text>
      <Text
        sx={{
          flexShrink: 0,
          minWidth: 18,
          px: '6px',
          py: '1px',
          borderRadius: 999,
          bg: active ? 'accent.subtle' : 'neutral.subtle',
          color: active ? 'accent.fg' : 'fg.muted',
          fontFamily: 'mono',
          fontSize: '10px',
          fontWeight: 700,
          lineHeight: 1.25,
          textAlign: 'center',
        }}
      >
        {count}
      </Text>
    </Box>
  );
}

// ─── Generic panels ──────────────────────────────────────────────────────────

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.default', overflowX: 'auto', overflowY: 'hidden' }}>
      {children}
    </Box>
  );
}

function PanelLoading() {
  // Generic skeleton for any tab panel — readme, code, issues, pulls, etc.
  // A few text-line shapes feel more accurate than a centered spinner since
  // most panels render text/table content.
  return (
    <Panel>
      <Box sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <Box
            key={i}
            sx={{ display: 'flex', alignItems: 'center', gap: 3, opacity: Math.max(0.25, 1 - i * 0.09) }}
          >
            <SkeletonBar width={i % 3 === 0 ? 14 : 12} height={i % 3 === 0 ? 14 : 12} rounded={i % 3 === 0 ? 999 : 6} />
            <SkeletonBar flex={1} height={10} />
            {i % 2 === 0 && <SkeletonBar width={60} height={10} />}
          </Box>
        ))}
      </Box>
    </Panel>
  );
}

function PanelError({ message }: { message: string }) {
  return (
    <Box sx={{ p: 3, border: '1px solid', borderColor: 'danger.emphasis', bg: 'danger.subtle', borderRadius: 2 }}>
      <Text sx={{ color: 'danger.fg' }}>{message}</Text>
    </Box>
  );
}

function PanelEmpty({ title, message }: { title: string; message: string }) {
  return (
    <Panel>
      <Box sx={{ p: 5, textAlign: 'center' }}>
        <Heading sx={{ fontSize: 3, mb: 1 }}>{title}</Heading>
        <Text sx={{ color: 'fg.muted' }}>{message}</Text>
      </Box>
    </Panel>
  );
}
