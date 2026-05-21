'use client';

import React from 'react';
import { Box } from '@primer/react';
import {
  GitPullRequestIcon, GitMergeIcon, GitPullRequestClosedIcon,
  IssueOpenedIcon, IssueClosedIcon, SkipIcon, RepoIcon,
} from '@primer/octicons-react';
import { formatUsd } from '@/lib/format';
import { Card, CardHeader } from '../../components';
import { HeroTile, CountBadge } from './shared';
import type { MinerProfile, Mode, Period } from './types';

export interface PrAgg {
  total: number;
  merged: number;
  open: number;
  closed: number;
  realScoreSum: number;
  additions: number;
  deletions: number;
  predictedUsd: number;
  uniqueRepos: number;
}

export interface IssueAgg {
  total: number;
  solved: number;
  completed: number;
  open: number;
  closed: number;
  solvedExternal: number;
  uniqueRepos: number;
}

const PERIOD_LABEL: Record<Period, string> = {
  '1D':  'Last 24h',
  '7D':  'Last 7d',
  '30D': 'Last 30d',
  ALL:   'All-time',
};

export function ActivitySummary({
  mode, prAgg, issueAgg, ossEligible, issueEligible, issueScore, miner, period,
}: {
  mode: Mode;
  prAgg: PrAgg;
  issueAgg: IssueAgg;
  ossEligible: boolean;
  issueEligible: boolean;
  issueScore: number;
  miner: MinerProfile | undefined;
  period: Period;
}) {
  const periodLabel = PERIOD_LABEL[period];

  if (mode === 'oss') {
    const mergeRate = prAgg.total > 0 ? Math.round((prAgg.merged / prAgg.total) * 100) : 0;
    const earning = prAgg.predictedUsd > 0 ? formatUsd(prAgg.predictedUsd, { style: 'compact' }) : '—';
    const score   = prAgg.realScoreSum > 0 ? prAgg.realScoreSum.toFixed(2) : '—';

    return (
      <Card>
        <CardHeader
          icon={<GitPullRequestIcon size={13} />}
          title="Activity"
          sub={`OSS · ${periodLabel}`}
        />
        <Box sx={{ display: 'flex', alignItems: 'stretch', bg: 'canvas.default', borderBottom: '1px solid', borderColor: 'border.muted' }}>
          <HeroTile
            label="PRs"
            value={prAgg.total.toLocaleString()}
            sub={`${prAgg.uniqueRepos} repo${prAgg.uniqueRepos === 1 ? '' : 's'}`}
          />
          <HeroTile
            label="Merge rate"
            value={prAgg.total > 0 ? `${mergeRate}%` : '—'}
            sub={prAgg.total > 0 ? `${prAgg.merged} of ${prAgg.total}` : '—'}
            tone="done"
          />
          <HeroTile
            label="Score"
            value={score}
            sub={ossEligible ? 'window · live' : 'ineligible'}
          />
          <HeroTile
            label="Earning"
            value={earning}
            sub="predicted / day"
            tone={prAgg.predictedUsd > 0 ? 'success' : 'neutral'}
            last
          />
        </Box>
        <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
          <CountBadge icon={<RepoIcon size={11} />}                  value={prAgg.uniqueRepos} label="repos"  tone="accent" />
          <CountBadge icon={<GitMergeIcon size={11} />}              value={prAgg.merged}      label="merged" tone="done" />
          <CountBadge icon={<GitPullRequestIcon size={11} />}        value={prAgg.open}        label="open"   tone="success" />
          <CountBadge icon={<GitPullRequestClosedIcon size={11} />}  value={prAgg.closed}     label="closed" tone="danger" />
        </Box>
      </Card>
    );
  }

  // Discovery mode — ALL period uses lifetime totals on the miner record so
  // counts stay stable when the windowed query has empty buckets.
  const useTotals = period === 'ALL';
  const totalIssues = useTotals
    ? (miner?.totalSolvedIssues ?? 0) + (miner?.totalOpenIssues ?? 0) + (miner?.totalClosedIssues ?? 0)
    : issueAgg.total;
  const solvedDisplay = useTotals ? (miner?.totalSolvedIssues ?? 0) : issueAgg.solved + issueAgg.completed;
  const openDisplay   = useTotals ? (miner?.totalOpenIssues   ?? 0) : issueAgg.open;
  const closedDisplay = useTotals ? (miner?.totalClosedIssues ?? 0) : issueAgg.closed;
  const solveRate = totalIssues > 0 ? Math.round((solvedDisplay / totalIssues) * 100) : 0;

  return (
    <Card>
      <CardHeader
        icon={<IssueOpenedIcon size={13} />}
        title="Activity"
        sub={`Discovery · ${periodLabel}`}
      />
      <Box sx={{ display: 'flex', alignItems: 'stretch', bg: 'canvas.default', borderBottom: '1px solid', borderColor: 'border.muted' }}>
        <HeroTile
          label="Issues"
          value={totalIssues.toLocaleString()}
          sub={useTotals ? 'lifetime' : `${issueAgg.uniqueRepos} repo${issueAgg.uniqueRepos === 1 ? '' : 's'}`}
        />
        <HeroTile
          label="Solve rate"
          value={totalIssues > 0 ? `${solveRate}%` : '—'}
          sub={totalIssues > 0 ? `${solvedDisplay} of ${totalIssues}` : '—'}
          tone="done"
        />
        <HeroTile
          label="Score"
          value={issueScore > 0 ? issueScore.toFixed(2) : '—'}
          sub={issueScore > 0 ? 'discovery' : issueEligible ? 'no emission' : 'ineligible'}
        />
        <HeroTile
          label="Author solved"
          value={issueAgg.solvedExternal.toLocaleString()}
          sub="by you"
          tone="accent"
          last
        />
      </Box>
      <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
        <CountBadge icon={<RepoIcon size={11} />}        value={issueAgg.uniqueRepos} label="repos"  tone="accent" />
        <CountBadge icon={<IssueClosedIcon size={11} />} value={solvedDisplay}        label="solved" tone="done" />
        <CountBadge icon={<IssueOpenedIcon size={11} />} value={openDisplay}          label="open"   tone="success" />
        <CountBadge icon={<SkipIcon size={11} />}        value={closedDisplay}        label="closed" tone="danger" />
      </Box>
    </Card>
  );
}
