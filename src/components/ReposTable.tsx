'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  TextInput,
  Text,
  Label,
  IconButton,
} from '@primer/react';
import Dropdown from '@/components/Dropdown';
import {
  RepoIcon,
  SearchIcon,
  TriangleDownIcon,
  TriangleUpIcon,
  LinkExternalIcon,
  StarIcon,
  StarFillIcon,
  IssueOpenedIcon,
  GitPullRequestIcon,
  GitMergeIcon,
  ClockIcon,
} from '@primer/octicons-react';
import type { Sn74Repo } from '@/lib/repos';
import { weightBand } from '@/lib/repos';
import { isTracked as repoIsTracked, useTrackedRepos } from '@/lib/tracked-repos';
import { formatRelativeTime, isRecent } from '@/lib/format';

export interface RepoStats {
  issues_total: number;
  issues_open: number;
  pulls_total: number;
  pulls_open: number;
  pulls_merged: number;
  last_activity_at: string | null;
  last_fetch_at: string | null;
}

type SortKey =
  | 'weight'
  | 'owner'
  | 'name'
  | 'issues_total'
  | 'issues_open'
  | 'pulls_total'
  | 'pulls_open'
  | 'pulls_merged'
  | 'activity';
type SortDir = 'asc' | 'desc';

const BAND_OPTIONS = [
  { id: 'all', label: 'All bands' },
  { id: 'flagship', label: 'Flagship (≥0.5)' },
  { id: 'high', label: 'High (0.3–0.5)' },
  { id: 'midhigh', label: 'Mid-high (0.15–0.3)' },
  { id: 'standard', label: 'Standard (0.05–0.15)' },
  { id: 'low', label: 'Low (<0.05)' },
];

export default function ReposTable({
  repos,
  userRepoNames,
  stats,
}: {
  repos: Sn74Repo[];
  userRepoNames?: Set<string>;
  stats?: Map<string, RepoStats>;
}) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('weight');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [band, setBand] = useState<string>('all');
  const [trackedOnly, setTrackedOnly] = useState(false);
  const { tracked, toggle: toggleTrack } = useTrackedRepos();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = repos.filter((r) => !q || r.fullName.toLowerCase().includes(q));
    list = list.filter((r) => {
      if (trackedOnly && !repoIsTracked(tracked, r.fullName)) return false;
      if (band === 'all') return true;
      if (band === 'flagship') return r.weight >= 0.5;
      if (band === 'high') return r.weight >= 0.3 && r.weight < 0.5;
      if (band === 'midhigh') return r.weight >= 0.15 && r.weight < 0.3;
      if (band === 'standard') return r.weight >= 0.05 && r.weight < 0.15;
      if (band === 'low') return r.weight < 0.05;
      return true;
    });
    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'weight') cmp = a.weight - b.weight;
      else if (sortKey === 'owner') cmp = a.owner.localeCompare(b.owner);
      else if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'issues_total') cmp = (stats?.get(a.fullName)?.issues_total ?? 0) - (stats?.get(b.fullName)?.issues_total ?? 0);
      else if (sortKey === 'issues_open') cmp = (stats?.get(a.fullName)?.issues_open ?? 0) - (stats?.get(b.fullName)?.issues_open ?? 0);
      else if (sortKey === 'pulls_total') cmp = (stats?.get(a.fullName)?.pulls_total ?? 0) - (stats?.get(b.fullName)?.pulls_total ?? 0);
      else if (sortKey === 'pulls_open') cmp = (stats?.get(a.fullName)?.pulls_open ?? 0) - (stats?.get(b.fullName)?.pulls_open ?? 0);
      else if (sortKey === 'pulls_merged') cmp = (stats?.get(a.fullName)?.pulls_merged ?? 0) - (stats?.get(b.fullName)?.pulls_merged ?? 0);
      else if (sortKey === 'activity') cmp = (stats?.get(a.fullName)?.last_activity_at ?? '').localeCompare(stats?.get(b.fullName)?.last_activity_at ?? '');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [repos, query, sortKey, sortDir, band, trackedOnly, tracked, stats]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'weight' ? 'desc' : 'asc');
    }
  };

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          gap: 2,
          alignItems: 'center',
          mb: 3,
          flexWrap: 'wrap',
        }}
      >
        <TextInput
          leadingVisual={SearchIcon}
          placeholder="Filter by owner, name, or full name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ width: 360, maxWidth: '100%' }}
        />
        <Dropdown
          value={band}
          onChange={(v) => setBand(v)}
          options={BAND_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
          width={200}
          ariaLabel="Filter by weight band"
        />
        <Box
          onClick={() => setTrackedOnly((v) => !v)}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 1,
            px: '12px',
            py: '5px',
            borderRadius: '6px',
            border: '1px solid',
            borderColor: trackedOnly ? 'var(--attention-emphasis)' : 'var(--border-default)',
            bg: trackedOnly ? 'var(--attention-subtle, rgba(242, 201, 76, 0.14))' : 'var(--bg-emphasis)',
            color: trackedOnly ? 'var(--attention-emphasis)' : 'var(--fg-default)',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 500,
            lineHeight: '20px',
            userSelect: 'none',
            '&:hover': { borderColor: 'var(--border-strong)' },
          }}
        >
          {trackedOnly ? <StarFillIcon size={14} /> : <StarIcon size={14} />}
          Tracked only ({tracked.size})
        </Box>
        <Text sx={{ color: 'fg.muted', ml: 'auto', fontSize: 1 }}>
          {filtered.length} of {repos.length}
        </Text>
      </Box>

      <Box
        sx={{
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 2,
          overflowX: 'auto',
          overflowY: 'hidden',
          bg: 'canvas.default',
        }}
      >
        <Box as="table" sx={{ width: '100%', minWidth: 1120, borderCollapse: 'collapse', fontSize: 1 }}>
          <Box
            as="thead"
            sx={{
              bg: 'canvas.subtle',
              borderBottom: '1px solid',
              borderColor: 'border.default',
            }}
          >
            <Box as="tr">
              <Box as="th" sx={{ ...headerCellSx, width: 36 }}></Box>
              <HeaderCell label="Repository" onClick={() => toggleSort('owner')} active={sortKey === 'owner'} dir={sortDir} />
              <HeaderCell label="Weight" onClick={() => toggleSort('weight')} active={sortKey === 'weight'} dir={sortDir} align="right" />
              <Box as="th" sx={headerCellSx}>
                Band
              </Box>
              <HeaderCell label="Issues" onClick={() => toggleSort('issues_total')} active={sortKey === 'issues_total'} dir={sortDir} align="right" />
              <HeaderCell label="Open" onClick={() => toggleSort('issues_open')} active={sortKey === 'issues_open'} dir={sortDir} align="right" />
              <HeaderCell label="PRs" onClick={() => toggleSort('pulls_total')} active={sortKey === 'pulls_total'} dir={sortDir} align="right" />
              <HeaderCell label="PR Open" onClick={() => toggleSort('pulls_open')} active={sortKey === 'pulls_open'} dir={sortDir} align="right" />
              <HeaderCell label="Merged" onClick={() => toggleSort('pulls_merged')} active={sortKey === 'pulls_merged'} dir={sortDir} align="right" />
              <HeaderCell label="Activity" onClick={() => toggleSort('activity')} active={sortKey === 'activity'} dir={sortDir} />
              <Box as="th" sx={{ ...headerCellSx, width: 80 }}>
                Actions
              </Box>
            </Box>
          </Box>
          <Box as="tbody">
            {filtered.map((repo) => (
              <RepoRow
                key={repo.fullName}
                repo={repo}
                tracked={repoIsTracked(tracked, repo.fullName)}
                onToggleTrack={() => toggleTrack(repo.fullName)}
                isCustom={userRepoNames?.has(repo.fullName) ?? false}
                stats={stats?.get(repo.fullName)}
              />
            ))}
            {filtered.length === 0 && (
              <Box as="tr">
                <Box as="td" sx={{ p: 4, textAlign: 'center', color: 'fg.muted' }} colSpan={5}>
                  No repositories match your filters.
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

const headerCellSx = {
  px: 3,
  py: 2,
  textAlign: 'left' as const,
  fontWeight: 600,
  fontSize: '12px',
  color: 'fg.muted',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  whiteSpace: 'nowrap' as const,
};

function HeaderCell({
  label,
  onClick,
  active,
  dir,
  align = 'left',
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  dir: SortDir;
  align?: 'left' | 'right';
}) {
  return (
    <Box
      as="th"
      sx={{
        ...headerCellSx,
        textAlign: align,
        cursor: 'pointer',
        userSelect: 'none',
        '&:hover': { color: 'fg.default' },
      }}
      onClick={onClick}
    >
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        {label}
        {active && (dir === 'asc' ? <TriangleUpIcon size={12} /> : <TriangleDownIcon size={12} />)}
      </Box>
    </Box>
  );
}

function StatCell({
  value,
  icon,
  color,
}: {
  value: number | undefined;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <Box
      as="td"
      sx={{
        px: 3,
        py: 2,
        textAlign: 'right',
        fontFamily: 'mono',
        fontVariantNumeric: 'tabular-nums',
        fontSize: 1,
        verticalAlign: 'middle',
        whiteSpace: 'nowrap',
      }}
    >
      {typeof value === 'number' && value > 0 ? (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color }}>
          {icon}
          {value}
        </Box>
      ) : (
        <Text sx={{ color: 'fg.subtle' }}>—</Text>
      )}
    </Box>
  );
}

function RepoRow({
  repo,
  tracked,
  onToggleTrack,
  isCustom,
  stats,
}: {
  repo: Sn74Repo;
  tracked: boolean;
  onToggleTrack: () => void;
  isCustom: boolean;
  stats?: RepoStats;
}) {
  const router = useRouter();
  const band = weightBand(repo.weight);
  const weightPct = Math.min(100, Math.round((repo.weight / 1.0) * 100));
  const weightBarBg =
    band.tone === 'success'
      ? 'var(--success-emphasis)'
      : band.tone === 'accent'
      ? 'var(--accent-emphasis)'
      : band.tone === 'attention'
      ? 'var(--attention-emphasis)'
      : band.tone === 'severe'
      ? '#e0823d'
      : 'var(--neutral-emphasis)';
  const internalHref = `/repos/${repo.owner}/${repo.name}`;
  const githubHref = `https://github.com/${repo.fullName}`;

  const handleRowClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
      window.open(internalHref, '_blank');
      return;
    }
    router.push(internalHref);
  };

  return (
    <Box
      as="tr"
      onClick={handleRowClick}
      sx={{
        borderBottom: '1px solid',
        borderColor: 'border.muted',
        bg: tracked ? 'attention.subtle' : 'transparent',
        cursor: 'pointer',
        '&:hover': { bg: tracked ? 'attention.muted' : 'canvas.subtle' },
        '&:last-child': { borderBottom: 'none' },
      }}
    >
      <Box as="td" sx={{ p: 2, textAlign: 'center', verticalAlign: 'middle' }}>
        <Box
          as="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleTrack();
          }}
          sx={{
            cursor: 'pointer',
            border: 'none',
            bg: 'transparent',
            color: tracked ? 'attention.fg' : 'fg.muted',
            p: 1,
            borderRadius: 1,
            display: 'inline-flex',
            alignItems: 'center',
            '&:hover': { bg: 'canvas.inset', color: 'attention.fg' },
          }}
          aria-label={tracked ? 'Untrack repo' : 'Track repo'}
        >
          {tracked ? <StarFillIcon size={14} /> : <StarIcon size={14} />}
        </Box>
      </Box>
      <Box as="td" sx={{ px: 3, py: 2, verticalAlign: 'middle' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <RepoIcon size={16} />
          <a
            href={githubHref}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ textDecoration: 'none' }}
          >
            <Text sx={{ color: 'accent.fg', fontWeight: 600, '&:hover': { textDecoration: 'underline' } }}>
              {repo.owner}/{repo.name}
            </Text>
          </a>
          {isCustom && (
            <Box
              sx={{
                px: '6px',
                py: '1px',
                bg: 'var(--accent-subtle)',
                color: 'accent.fg',
                fontSize: '10px',
                fontWeight: 700,
                borderRadius: 999,
                letterSpacing: '0.4px',
                textTransform: 'uppercase',
              }}
              title="Added from Manage Repositories"
            >
              Custom
            </Box>
          )}
        </Box>
      </Box>
      <Box as="td" sx={{ px: 3, py: 2, textAlign: 'right', fontFamily: 'mono', fontVariantNumeric: 'tabular-nums', verticalAlign: 'middle' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
          <Box sx={{ width: 80, height: 6, bg: 'canvas.inset', borderRadius: 999, overflow: 'hidden' }}>
            <Box
              sx={{ height: '100%' }}
              style={{
                width: `${weightPct}%`,
                backgroundColor: weightBarBg,
              }}
            />
          </Box>
          <Text
            sx={{
              minWidth: 64,
              display: 'inline-block',
              fontSize: 1,
              fontWeight: repo.weight >= 0.3 ? 700 : repo.weight >= 0.15 ? 600 : repo.weight >= 0.05 ? 500 : 400,
              color:
                repo.weight >= 0.5
                  ? 'success.fg'
                  : repo.weight >= 0.3
                  ? 'accent.fg'
                  : repo.weight >= 0.15
                  ? 'attention.fg'
                  : repo.weight >= 0.05
                  ? 'fg.default'
                  : 'fg.muted',
            }}
          >
            {repo.weight.toFixed(4)}
          </Text>
        </Box>
      </Box>
      <Box as="td" sx={{ px: 3, py: 2, verticalAlign: 'middle' }}>
        <Label variant={band.tone === 'neutral' ? 'secondary' : band.tone}>{band.label}</Label>
      </Box>
      <StatCell value={stats?.issues_total} icon={<IssueOpenedIcon size={12} />} color="fg.default" />
      <StatCell value={stats?.issues_open} icon={<IssueOpenedIcon size={12} />} color="success.fg" />
      <StatCell value={stats?.pulls_total} icon={<GitPullRequestIcon size={12} />} color="fg.default" />
      <StatCell value={stats?.pulls_open} icon={<GitPullRequestIcon size={12} />} color="success.fg" />
      <StatCell value={stats?.pulls_merged} icon={<GitMergeIcon size={12} />} color="done.fg" />
      <Box as="td" sx={{ px: 3, py: 2, verticalAlign: 'middle', fontSize: 0, color: 'fg.muted', whiteSpace: 'nowrap' }}>
        {stats?.last_activity_at ? (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
            <ClockIcon size={12} />
            <Text sx={{ color: isRecent(stats.last_activity_at) ? 'success.fg' : 'fg.muted', fontWeight: isRecent(stats.last_activity_at) ? 700 : 400 }}>
              {formatRelativeTime(stats.last_activity_at)}
            </Text>
          </Box>
        ) : (
          <Text sx={{ color: 'fg.subtle' }}>—</Text>
        )}
      </Box>
      <Box as="td" sx={{ px: 3, py: 2, verticalAlign: 'middle' }} onClick={(e) => e.stopPropagation()}>
        <IconButton
          as="a"
          href={githubHref}
          target="_blank"
          rel="noreferrer"
          icon={LinkExternalIcon}
          aria-label="Open on GitHub"
          size="small"
          variant="invisible"
        />
      </Box>
    </Box>
  );
}
