'use client';

import React from 'react';
import { Box, Text } from '@primer/react';
import {
  IssueOpenedIcon,
  IssueClosedIcon,
  GitPullRequestIcon,
  GitPullRequestDraftIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  SkipIcon,
  type Icon,
} from '@primer/octicons-react';
import type { Issue, Pull } from '@/types/entities';
import { pullStatus } from '@/types/entities';

const ISSUE_STYLE = {
  open: { bg: 'open.emphasis', fg: 'fg.onEmphasis', icon: IssueOpenedIcon, label: 'Open' },
  completed: { bg: 'done.emphasis', fg: 'fg.onEmphasis', icon: IssueClosedIcon, label: 'Completed' },
  not_planned: { bg: 'neutral.emphasis', fg: 'fg.onEmphasis', icon: SkipIcon, label: 'Not planned' },
  closed: { bg: 'closed.emphasis', fg: 'fg.onEmphasis', icon: IssueClosedIcon, label: 'Closed' },
  duplicate: { bg: 'neutral.emphasis', fg: 'fg.onEmphasis', icon: IssueClosedIcon, label: 'Duplicate' },
};

const PR_STYLE = {
  open: { bg: 'open.emphasis', fg: 'fg.onEmphasis', icon: GitPullRequestIcon, label: 'Open' },
  draft: { bg: 'neutral.emphasis', fg: 'fg.onEmphasis', icon: GitPullRequestDraftIcon, label: 'Draft' },
  merged: { bg: 'done.emphasis', fg: 'fg.onEmphasis', icon: GitMergeIcon, label: 'Merged' },
  closed: { bg: 'closed.emphasis', fg: 'fg.onEmphasis', icon: GitPullRequestClosedIcon, label: 'Closed' },
};

export type EffectiveIssueState = 'open' | 'completed' | 'not_planned' | 'duplicate' | 'closed';

/**
 * Five buckets the dashboard groups issues into. Matches the Gittensor
 * mining model: only an issue solved by an actually-merged PR via GitHub's
 * `closingIssuesReferences` qualifies as Completed.
 *
 *   open        — state = 'open'
 *   completed   — closed + state_reason='completed' AND has ≥1 MERGED linked PR
 *   not_planned — closed + state_reason='not_planned'
 *   duplicate   — closed + state_reason='duplicate'
 *   closed      — everything else closed, including state_reason='completed'
 *                 *without* a merged linked PR (Gittensor's risky/negative
 *                 category) and reopened/null-reason
 *
 * `mergedPRCount === null` means the related-PR map hasn't loaded yet. In
 * that transient detail-view state we trust GitHub's close reason so a
 * completed issue doesn't briefly render as generic Closed. List/table views
 * pass a concrete count from the server and keep the strict mining buckets.
 */
export function effectiveIssueState(
  issue: Issue,
  mergedPRCount: number | null,
): EffectiveIssueState {
  if (issue.state === 'open') return 'open';
  const reason = (issue.state_reason ?? '').toUpperCase();
  if (reason === 'NOT_PLANNED') return 'not_planned';
  if (reason === 'DUPLICATE') return 'duplicate';
  if (reason === 'COMPLETED' && (mergedPRCount === null || mergedPRCount > 0)) return 'completed';
  return 'closed';
}

export const IssueStatusBadge = React.memo(function IssueStatusBadge({
  issue,
  mergedPRCount = null,
}: {
  issue: Issue;
  mergedPRCount?: number | null;
}) {
  return <Pill style={ISSUE_STYLE[effectiveIssueState(issue, mergedPRCount)]} />;
});

export const PullStatusBadge = React.memo(function PullStatusBadge({ pr }: { pr: Pull }) {
  const s = pullStatus(pr);
  return <Pill style={PR_STYLE[s]} />;
});

function Pill({
  style,
}: {
  style: { bg: string; fg: string; icon: Icon; label: string };
}) {
  const Icon = style.icon;
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: '2px',
        borderRadius: 999,
        bg: style.bg,
        color: style.fg,
        fontSize: 0,
        fontWeight: 600,
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
      }}
    >
      <Icon size={12} />
      <Text>{style.label}</Text>
    </Box>
  );
}
