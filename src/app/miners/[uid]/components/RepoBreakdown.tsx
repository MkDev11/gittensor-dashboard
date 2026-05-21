'use client';

import React, { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { Box, Text } from '@primer/react';
import {
  RepoIcon,
  GitMergeIcon, GitPullRequestIcon, GitPullRequestClosedIcon,
  IssueClosedIcon, IssueOpenedIcon, SkipIcon,
  CheckCircleIcon, LinkExternalIcon,
  TriangleDownIcon, TriangleUpIcon,
} from '@primer/octicons-react';
import { formatUsd } from '@/lib/format';
import {
  Card, CardHeader, CountCell, IntensityBar, Pagination, SearchBox,
  EmptyState, MONO, LABEL,
} from '../../components';
import { useSearchPage } from './shared';
import type { Mode, RepoBucket, RepoEval } from './types';

/* ─────────────────────────── Column layout ─────────────────────────── */

type SortCol = 'repo' | 'merged' | 'valid' | 'open' | 'closed' | 'cred' | 'score' | 'earning' | 'solved';
type SortDir = 'asc' | 'desc';

// 10 cols: repo, eligibility dot, primary, valid, open, closed, cred, earn%, $/d, score.
const REPO_COLS = 'minmax(220px, 2.2fr) 58px 70px 60px 58px 62px minmax(70px, 96px) 68px 84px 62px';

/* ─────────────────────────── Per-repo P&L table ─────────────────────────── */

export interface RepoBreakdownProps {
  repos: RepoBucket[];
  selectedRepo: string | null;
  onSelectRepo: (repo: string) => void;
  mode: Mode;
  ossEarningPerDay: number;
  discEarningPerDay: number;
  issueDiscoveryScore: number;
  repoEvalMap: Map<string, RepoEval>;
}

export function RepoBreakdown({
  repos, selectedRepo, onSelectRepo, mode,
  ossEarningPerDay, discEarningPerDay, issueDiscoveryScore, repoEvalMap,
}: RepoBreakdownProps) {
  const [sortCol, setSortCol] = useState<SortCol>('earning');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sorted = useMemo(() => {
    const eligOf = (r: RepoBucket) => mode === 'oss'
      ? repoEvalMap.get(r.repo.toLowerCase())?.isEligible === true
      : repoEvalMap.get(r.repo.toLowerCase())?.isIssueEligible === true;
    const valueOf = (r: RepoBucket, col: SortCol): number => {
      if (mode === 'oss') {
        switch (col) {
          case 'merged':  return r.merged;
          case 'valid':   return r.validPrs;
          case 'open':    return r.openPr;
          case 'closed':  return r.closedPr;
          case 'cred':    return (r.merged + r.closedPr) > 0 ? r.merged / (r.merged + r.closedPr) : 0;
          case 'score':   return r.realScore;
          case 'earning': return r.predictedUsd;
          case 'solved':  return r.merged;
          case 'repo':    return 0;
        }
      } else {
        switch (col) {
          case 'solved':  return r.solvedIssue;
          case 'valid':   return repoEvalMap.get(r.repo.toLowerCase())?.totalValidSolvedIssues ?? r.solvedByPr.length;
          case 'open':    return r.openIssue;
          case 'closed':  return r.closedIssue;
          case 'cred':    return (r.solvedIssue + r.closedIssue) > 0 ? r.solvedIssue / (r.solvedIssue + r.closedIssue) : 0;
          case 'score':   return r.solvedIssue;
          case 'earning': return r.solvedIssue;
          case 'merged':  return r.solvedIssue;
          case 'repo':    return 0;
        }
      }
    };
    return [...repos].sort((a, b) => {
      const ae = eligOf(a), be = eligOf(b);
      if (ae !== be) return ae ? -1 : 1;
      if (sortCol === 'repo') {
        const cmp = a.repo.localeCompare(b.repo);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const cmp = valueOf(a, sortCol) - valueOf(b, sortCol);
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [repos, sortCol, sortDir, mode, repoEvalMap]);

  const { search, setSearch, page, setPage, pageCount, filtered, paged } = useSearchPage(
    sorted,
    (r, q) => r.repo.toLowerCase().includes(q),
    15,
  );

  // Only eligible repos share the live earnings pool. Scales are derived from
  // the validator's per-repo predicted USD so summed rows match the network total.
  const ossEarnScale = useMemo(() => {
    const eligibleRaw = repos.reduce((s, r) => s + (repoEvalMap.get(r.repo.toLowerCase())?.isEligible ? r.predictedUsd : 0), 0);
    return eligibleRaw > 0 ? ossEarningPerDay / eligibleRaw : 0;
  }, [repos, ossEarningPerDay, repoEvalMap]);
  const discEarnScale = useMemo(() => {
    const totalSolved = repos.reduce((s, r) => s + (repoEvalMap.get(r.repo.toLowerCase())?.isIssueEligible ? r.solvedIssue : 0), 0);
    return totalSolved > 0 ? discEarningPerDay / totalSolved : 0;
  }, [repos, discEarningPerDay, repoEvalMap]);
  const discScoreScale = useMemo(() => {
    const totalSolved = repos.reduce((s, r) => s + (repoEvalMap.get(r.repo.toLowerCase())?.isIssueEligible ? r.solvedIssue : 0), 0);
    return totalSolved > 0 ? issueDiscoveryScore / totalSolved : 0;
  }, [repos, issueDiscoveryScore, repoEvalMap]);

  const earningOf = useCallback((r: RepoBucket) => {
    const e = repoEvalMap.get(r.repo.toLowerCase());
    if (mode === 'oss')   return e?.isEligible      ? r.predictedUsd * ossEarnScale : 0;
    if (mode === 'discovery') return e?.isIssueEligible ? r.solvedIssue  * discEarnScale : 0;
    return 0;
  }, [mode, ossEarnScale, discEarnScale, repoEvalMap]);

  const totalEarn = useMemo(() => {
    let s = 0;
    for (const r of repos) s += earningOf(r);
    return s;
  }, [repos, earningOf]);

  const sums = useMemo(() => {
    let merged = 0, open = 0, closed = 0, scoreSum = 0, earnSum = 0;
    let solved = 0, valid = 0;
    for (const r of repos) {
      const e = repoEvalMap.get(r.repo.toLowerCase());
      if (mode === 'oss') {
        merged += r.merged; open += r.openPr; closed += r.closedPr;
        valid += r.validPrs;
        if (e?.isEligible) scoreSum += r.realScore;
        earnSum += e?.isEligible ? r.predictedUsd * ossEarnScale : 0;
      } else {
        solved += r.solvedIssue; open += r.openIssue; closed += r.closedIssue;
        valid += e?.totalValidSolvedIssues ?? r.solvedByPr.length;
        if (e?.isIssueEligible) earnSum += r.solvedIssue * discEarnScale;
      }
    }
    if (mode === 'discovery') scoreSum = issueDiscoveryScore;
    return { merged, solved, valid, open, closed, scoreSum, earnSum };
  }, [repos, repoEvalMap, mode, ossEarnScale, discEarnScale, issueDiscoveryScore]);

  if (repos.length === 0) {
    return <EmptyState icon={<RepoIcon size={20} />} text="No repository activity in this window." />;
  }

  const toggleSort = (col: SortCol) => {
    if (col === sortCol) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('desc'); }
    setPage(0);
  };

  const primaryLabel = mode === 'oss' ? 'Merged' : 'Solved';

  return (
    <Card>
      <CardHeader
        icon={<RepoIcon size={13} />}
        title="Per-repository P&L"
        sub={selectedRepo ? `filtering · ${selectedRepo}` : `${repos.length} repo${repos.length === 1 ? '' : 's'}`}
        right={
          <>
            <Pagination page={page} pageCount={pageCount} total={repos.length} filtered={filtered.length} onPage={setPage} zeroIndexed />
            <SearchBox value={search} onChange={setSearch} placeholder="Filter repos…" />
          </>
        }
      />

      <Box sx={{ overflowX: 'auto' }}>
        <Box sx={{ minWidth: 880 }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: REPO_COLS,
              alignItems: 'center',
              borderBottom: '1px solid',
              borderColor: 'border.muted',
              bg: 'canvas.default',
              px: 2,
              py: '8px',
              columnGap: 1,
            }}
          >
            <RepoHdrCell align="left" active={sortCol === 'repo'} dir={sortDir} onClick={() => toggleSort('repo')}>Repository</RepoHdrCell>
            <RepoHdrCell align="center" title="Eligibility for the current track">Eligible</RepoHdrCell>
            <RepoHdrCell active={sortCol === (mode === 'oss' ? 'merged' : 'solved')} dir={sortDir}
              onClick={() => toggleSort(mode === 'oss' ? 'merged' : 'solved')}>{primaryLabel}</RepoHdrCell>
            <RepoHdrCell
              active={sortCol === 'valid'} dir={sortDir} onClick={() => toggleSort('valid')}
              title={mode === 'oss' ? 'Merged PRs with tokenScore ≥ 5' : 'Solved issues counted toward eligibility'}
            >Valid</RepoHdrCell>
            <RepoHdrCell active={sortCol === 'open'} dir={sortDir} onClick={() => toggleSort('open')}>Open</RepoHdrCell>
            <RepoHdrCell active={sortCol === 'closed'} dir={sortDir} onClick={() => toggleSort('closed')}>Closed</RepoHdrCell>
            <RepoHdrCell active={sortCol === 'cred'} dir={sortDir} onClick={() => toggleSort('cred')}>Cred</RepoHdrCell>
            <RepoHdrCell
              active={sortCol === 'earning'} dir={sortDir} onClick={() => toggleSort('earning')}
              title="Share of total daily earnings (earning ÷ Σ earnings)"
            >Earn %</RepoHdrCell>
            <RepoHdrCell active={sortCol === 'earning'} dir={sortDir} onClick={() => toggleSort('earning')}>$/Day</RepoHdrCell>
            <RepoHdrCell active={sortCol === 'score'} dir={sortDir} onClick={() => toggleSort('score')}>Score</RepoHdrCell>
          </Box>

          {paged.map((r) => (
            <RepoRow
              key={r.repo}
              row={r}
              isSelected={selectedRepo === r.repo}
              onSelect={() => onSelectRepo(r.repo)}
              mode={mode}
              repoEval={repoEvalMap.get(r.repo.toLowerCase())}
              earning={earningOf(r)}
              totalEarn={totalEarn}
              discScoreScale={discScoreScale}
            />
          ))}

          {filtered.length === 0 && (
            <Box sx={{ py: 4, textAlign: 'center', color: 'fg.muted', fontSize: 0 }}>
              No repositories match “{search}”
            </Box>
          )}

          {/* Sum row */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: REPO_COLS,
              alignItems: 'center',
              columnGap: 1,
              borderTop: '2px solid',
              borderColor: 'border.default',
              bg: 'canvas.inset',
              px: 2,
              py: '8px',
            }}
          >
            <Text sx={{ ...LABEL, color: 'fg.muted' }}>{repos.length} repos</Text>
            <span />
            {/* Valid intentionally has no total — sum of per-repo Valid counts
                differs from the miner-level Valid the validator applies. */}
            <SumNum v={mode === 'oss' ? sums.merged : sums.solved} />
            <span />
            <SumNum v={sums.open} />
            <SumNum v={sums.closed} />
            <span />
            <SumNum v={sums.earnSum > 0 ? '100%' : '—'} />
            <SumNum v={sums.earnSum > 0 ? formatUsd(sums.earnSum, { style: 'compact' }) : '—'} tone="success" />
            <SumNum v={sums.scoreSum > 0 ? sums.scoreSum.toFixed(2) : '—'} />
          </Box>
        </Box>
      </Box>
    </Card>
  );
}

/* ─────────────────────────── Header cell ─────────────────────────── */

function RepoHdrCell({
  children, active = false, dir, onClick, align = 'right', title,
}: {
  children: React.ReactNode;
  active?: boolean;
  dir?: SortDir;
  onClick?: () => void;
  align?: 'left' | 'right' | 'center';
  title?: string;
}) {
  const baseSx = {
    ...LABEL,
    color: active ? 'fg.default' : 'fg.muted',
    textAlign: align,
    px: '4px',
  } as const;
  if (!onClick) {
    return <Text title={title} sx={baseSx}>{children}</Text>;
  }
  return (
    <Box
      as="button"
      onClick={onClick}
      sx={{
        ...baseSx,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
        gap: '3px',
        bg: 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        '&:hover': { color: 'fg.default' },
      }}
    >
      {children}
      {active && (dir === 'desc' ? <TriangleDownIcon size={9} /> : <TriangleUpIcon size={9} />)}
    </Box>
  );
}

/* ─────────────────────────── Sum row cell ─────────────────────────── */

function SumNum({ v, tone = 'neutral' }: { v: number | string; tone?: 'neutral' | 'success' | 'danger' | 'done' }) {
  const fg = tone === 'success' ? 'success.fg' : tone === 'danger' ? 'danger.fg' : tone === 'done' ? 'done.fg' : 'fg.default';
  const empty = v === '—' || v === 0;
  return (
    <Text
      sx={{ ...MONO, fontSize: '11px', fontWeight: 700, textAlign: 'right', pr: '4px' }}
      style={{ color: empty ? 'var(--fg-muted)' : `var(--${tone}-fg, var(--fg-default))` }}
    >
      <Box as="span" sx={{ color: fg }}>{typeof v === 'number' ? v.toLocaleString() : v}</Box>
    </Text>
  );
}

/* ─────────────────────────── Repo row ─────────────────────────── */

function RepoRow({
  row, isSelected, onSelect, mode, repoEval, earning, totalEarn, discScoreScale,
}: {
  row: RepoBucket;
  isSelected: boolean;
  onSelect: () => void;
  mode: Mode;
  repoEval: RepoEval | undefined;
  earning: number;
  totalEarn: number;
  discScoreScale: number;
}) {
  const [owner, name] = row.repo.split('/');
  const isEligible = mode === 'oss' ? repoEval?.isEligible === true : repoEval?.isIssueEligible === true;
  const credPct = mode === 'oss'
    ? ((row.merged + row.closedPr) > 0 ? Math.round((row.merged / (row.merged + row.closedPr)) * 100) : null)
    : ((row.solvedIssue + row.closedIssue) > 0 ? Math.round((row.solvedIssue / (row.solvedIssue + row.closedIssue)) * 100) : null);
  const share = totalEarn > 0 ? earning / totalEarn : 0;
  // Discovery: prefer upstream's authoritative count, fall back to local link data.
  const validCount = mode === 'oss'
    ? row.validPrs
    : (repoEval?.totalValidSolvedIssues ?? row.solvedByPr.length);
  const score = mode === 'oss'
    ? (isEligible && row.realScore > 0 ? row.realScore : 0)
    : (isEligible ? row.solvedIssue * discScoreScale : 0);

  return (
    <Box
      as="button"
      onClick={onSelect}
      sx={{
        width: '100%',
        display: 'grid',
        gridTemplateColumns: REPO_COLS,
        alignItems: 'center',
        columnGap: 1,
        px: 2,
        py: '8px',
        border: 'none',
        borderBottom: '1px solid',
        borderColor: 'border.muted',
        '&:last-of-type': { borderBottom: 'none' },
        color: 'fg.default',
        textAlign: 'left',
        fontFamily: 'inherit',
        cursor: 'pointer',
        bg: isSelected ? 'canvas.inset' : 'transparent',
        boxShadow: isSelected ? 'inset 2px 0 0 var(--accent-fg)' : 'none',
        transition: 'background-color 100ms',
        '&:hover': { bg: 'canvas.default' },
      }}
    >
      {/* stopPropagation: row click toggles repo selection; the link navigates. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, pr: 1 }}>
        <Link
          href={`/repos/${owner}/${name}`}
          prefetch={false}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Open ${row.repo} repository page`}
          title={`Open ${row.repo}`}
          style={{ textDecoration: 'none', display: 'inline-flex', flexShrink: 0 }}
        >
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'border.muted',
              bg: 'canvas.default',
              color: 'fg.muted',
              transition: 'color 100ms, border-color 100ms, background-color 100ms',
              '&:hover': { bg: 'canvas.inset', color: 'fg.default', borderColor: 'border.default' },
            }}
          >
            <LinkExternalIcon size={11} />
          </Box>
        </Link>
        <RepoIcon size={11} />
        <Text
          sx={{
            fontSize: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'block',
            fontWeight: isSelected ? 700 : 600,
            color: 'fg.default',
            flex: 1,
            minWidth: 0,
          }}
          title={row.repo}
        >
          {row.repo}
        </Text>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        <Box
          aria-label={isEligible ? 'Eligible' : 'Not eligible'}
          title={isEligible ? 'Eligible' : 'Not eligible'}
          sx={{ width: 6, height: 6, borderRadius: 999, bg: isEligible ? 'success.fg' : 'transparent', border: isEligible ? 'none' : '1px solid', borderColor: 'border.muted' }}
        />
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0, pr: '4px' }}>
        <CountCell
          icon={mode === 'oss' ? <GitMergeIcon size={11} /> : <IssueClosedIcon size={11} />}
          value={mode === 'oss' ? row.merged : row.solvedIssue}
          tone="done"
          title={mode === 'oss' ? 'Merged PRs' : 'Solved issues'}
        />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0, pr: '4px' }}>
        <CountCell
          icon={<CheckCircleIcon size={11} />}
          value={validCount}
          tone="accent"
          title={mode === 'oss' ? 'Merged PRs with tokenScore ≥ 5' : 'Solved issues counted toward eligibility'}
        />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0, pr: '4px' }}>
        <CountCell
          icon={mode === 'oss' ? <GitPullRequestIcon size={11} /> : <IssueOpenedIcon size={11} />}
          value={mode === 'oss' ? row.openPr : row.openIssue}
          tone="success"
          title={mode === 'oss' ? 'Open PRs' : 'Open issues'}
        />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0, pr: '4px' }}>
        <CountCell
          icon={mode === 'oss' ? <GitPullRequestClosedIcon size={11} /> : <SkipIcon size={11} />}
          value={mode === 'oss' ? row.closedPr : row.closedIssue}
          tone="danger"
          title={mode === 'oss' ? 'Closed (unmerged) PRs' : 'Closed (not-planned) issues'}
        />
      </Box>

      <Box
        sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, px: '4px' }}
        title={credPct != null ? `Credibility · ${credPct}%` : 'Credibility · —'}
      >
        <IntensityBar value={credPct != null ? credPct / 100 : 0} height={4} tone="neutral" />
        <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted', textAlign: 'right', lineHeight: 1 }}>
          {credPct != null ? `${credPct}%` : '—'}
        </Text>
      </Box>

      <NumCell v={share > 0 ? `${Math.round(share * 100)}%` : '—'} />
      <NumCell v={earning > 0 ? formatUsd(earning, { style: 'compact' }) : '—'} tone="success" bold />
      <NumCell v={score > 0 ? score.toFixed(2) : '—'} />
    </Box>
  );
}

function NumCell({
  v, tone = 'neutral', bold = false,
}: {
  v: number | string;
  tone?: 'neutral' | 'success' | 'danger' | 'done';
  bold?: boolean;
}) {
  const fg =
    tone === 'success' ? 'success.fg'
    : tone === 'danger'  ? 'danger.fg'
    : tone === 'done'    ? 'done.fg'
    : 'fg.default';
  const empty = v === '—' || v === 0;
  return (
    <Text
      sx={{
        ...MONO,
        fontSize: '11px',
        fontWeight: bold ? 700 : 600,
        textAlign: 'right',
        pr: '4px',
        color: empty ? 'fg.muted' : fg,
      }}
    >
      {typeof v === 'number' ? v.toLocaleString() : v}
    </Text>
  );
}
