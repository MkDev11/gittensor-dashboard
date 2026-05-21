'use client';

import React, { useEffect, useRef, useState, useId } from 'react';
import { Box, Text, Label } from '@primer/react';
import {
  GitPullRequestIcon, GitMergeIcon, GitPullRequestClosedIcon,
  LinkExternalIcon, MarkGithubIcon, XIcon, IssueOpenedIcon, GitCommitIcon,
} from '@primer/octicons-react';
import { formatUsd, formatRelativeTime } from '@/lib/format';
import {
  Card, CardHeader, Metric, SearchBox, RowSizeSelector, PageNav, EmptyState,
  MONO, LABEL,
} from '../../components';
import { ListLoading, useSearchPage } from './shared';
import type { PrDetail } from './types';

// Logistic decay curve with a 12h grace period and 5% floor; shared with PrModal for the chart.
const DECAY_PARAMS = { graceHours: 12, midpoint: 10, steepness: 0.4, floor: 0.05 };

function decayAt(daysSinceCreated: number): number {
  const graceDays = DECAY_PARAMS.graceHours / 24;
  if (daysSinceCreated <= graceDays) return 1;
  const d = daysSinceCreated - graceDays;
  const raw = 1 / (1 + Math.exp(DECAY_PARAMS.steepness * (d - DECAY_PARAMS.midpoint)));
  return Math.max(DECAY_PARAMS.floor, raw);
}

const PR_COLS = 'auto minmax(0, 1fr) 64px minmax(140px, 168px) 56px 148px 64px 72px 100px 100px 20px';

export function PrList({
  prs, loading, selectedRepo,
}: {
  prs: PrDetail[];
  loading: boolean;
  selectedRepo: string | null;
}) {
  const [modalPr, setModalPr] = useState<PrDetail | null>(null);
  const [pageSize, setPageSize] = useState(25);
  const { search, setSearch, page, setPage, filtered, paged: shown } = useSearchPage(
    prs,
    (pr, q) =>
      pr.title.toLowerCase().includes(q) ||
      pr.repository.toLowerCase().includes(q) ||
      String(pr.pullRequestNumber).includes(q),
    pageSize,
  );
  // Reset to page 0 when the repo filter changes (prs array reference changes).
  useEffect(() => { setPage(0); }, [prs, setPage]);

  if (loading) return <ListLoading label="Loading pull requests…" />;
  if (prs.length === 0) {
    return <EmptyState icon={<GitPullRequestIcon size={20} />} text="No pull requests in this window." />;
  }

  return (
    <>
      <Card>
        <CardHeader
          icon={<GitPullRequestIcon size={13} />}
          title="Pull requests"
          sub={selectedRepo ?? `${prs.length} total`}
          right={
            <>
              <RowSizeSelector
                value={pageSize}
                onChange={(n) => { setPageSize(n); setPage(0); }}
                showAll={false}
              />
              <SearchBox value={search} onChange={setSearch} placeholder="Search PRs…" />
            </>
          }
        />
        <Box>
          <Box
            sx={{
              display: ['none', null, 'grid'],
              gridTemplateColumns: PR_COLS,
              alignItems: 'center',
              gap: 2,
              px: 3,
              py: '6px',
              borderBottom: '1px solid',
              borderColor: 'border.muted',
              bg: 'canvas.default',
            }}
          >
            <span />
            <HdrLabel align="left">Title</HdrLabel>
            <HdrLabel align="left">Size</HdrLabel>
            <HdrLabel align="left">Repo</HdrLabel>
            <HdrLabel align="right">Commits</HdrLabel>
            <HdrLabel align="right">Changes</HdrLabel>
            <HdrLabel align="right">Score</HdrLabel>
            <HdrLabel align="right">$/Day</HdrLabel>
            <HdrLabel align="right">Status</HdrLabel>
            <HdrLabel align="right">Opened</HdrLabel>
            <span />
          </Box>
          {shown.map((pr) => (
            <PrRow key={`${pr.repository}#${pr.pullRequestNumber}`} pr={pr} onOpen={() => setModalPr(pr)} />
          ))}
          {filtered.length === 0 && (
            <Box sx={{ py: 4, textAlign: 'center', color: 'fg.muted', fontSize: 0 }}>
              No pull requests match “{search}”
            </Box>
          )}
        </Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            px: [2, null, 3],
            py: '8px',
            borderTop: '1px solid',
            borderTopColor: 'border.muted',
            bg: 'canvas.subtle',
          }}
        >
          <PageNav
            page={page + 1}
            pageSize={pageSize}
            filteredCount={filtered.length}
            onPage={(p) => setPage(p - 1)}
          />
        </Box>
      </Card>
      {modalPr && <PrModal pr={modalPr} onClose={() => setModalPr(null)} />}
    </>
  );
}

function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const mins = ms / 60_000;
  if (mins < 60) return `${Math.max(1, Math.round(mins))}m`;
  const hours = ms / 3_600_000;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = ms / 86_400_000;
  if (days < 7) return `${days.toFixed(1)}d`;
  if (days < 30) return `${Math.round(days)}d`;
  return `${(days / 7).toFixed(1)}w`;
}

function PrSizeChip({
  additions, deletions, variant = 'responsive',
}: { additions: number; deletions: number; variant?: 'responsive' | 'full' }) {
  const total = additions + deletions;
  if (total === 0) return null;
  const { short, full, color } = total < 10
    ? { short: 'XS', full: 'Tiny', color: 'fg.muted' }
    : total < 100
    ? { short: 'S', full: 'Small', color: 'success.fg' }
    : total < 500
    ? { short: 'M', full: 'Medium', color: 'success.fg' }
    : total < 1000
    ? { short: 'L', full: 'Large', color: 'attention.fg' }
    : { short: 'XL', full: 'Huge', color: 'danger.fg' };
  const label = variant === 'full' ? full : (
    <>
      <Box as="span" sx={{ display: ['inline', null, 'none'] }}>{short}</Box>
      <Box as="span" sx={{ display: ['none', null, 'inline'] }}>{full}</Box>
    </>
  );
  return (
    <Box
      sx={{
        ...MONO,
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: '9px',
        fontWeight: 700,
        letterSpacing: '0.3px',
        px: '4px',
        py: '1px',
        borderRadius: '3px',
        border: '1px solid',
        borderColor: 'border.muted',
        color,
        flexShrink: 0,
        whiteSpace: 'nowrap',
        lineHeight: 1,
      }}
      title={`${total.toLocaleString()} line${total === 1 ? '' : 's'} changed · ${full}`}
    >
      {label}
    </Box>
  );
}

function HdrLabel({ children, align = 'right' }: { children: string; align?: 'left' | 'right' }) {
  return (
    <Text sx={{ ...LABEL, color: 'fg.muted', textAlign: align, px: '4px', userSelect: 'none' }}>
      {children}
    </Text>
  );
}

function DiffBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  if (total === 0) return null;
  const addPct = (additions / total) * 100;
  return (
    <Box
      title={`+${additions.toLocaleString()} / −${deletions.toLocaleString()} (${Math.round(addPct)}% additions)`}
      sx={{ display: 'inline-flex', width: 26, height: 5, borderRadius: '1px', overflow: 'hidden', flexShrink: 0, bg: 'border.muted' }}
    >
      <Box aria-hidden style={{ width: `${addPct}%`, backgroundColor: 'var(--success-fg)', opacity: 0.75 }} />
      <Box aria-hidden style={{ width: `${100 - addPct}%`, backgroundColor: 'var(--danger-fg)', opacity: 0.75 }} />
    </Box>
  );
}

interface LinkedIssue { num: number; label: string; href: string }
function parseLinkedIssues(raw: string | null, repo: string): LinkedIssue[] {
  if (!raw) return [];
  const out: LinkedIssue[] = [];
  for (const part of raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)) {
    const match = part.match(/#?(\d+)/);
    if (!match) continue;
    const num = parseInt(match[1], 10);
    if (!Number.isFinite(num)) continue;
    out.push({ num, label: `#${num}`, href: `https://github.com/${repo}/issues/${num}` });
  }
  return out;
}

function PrRow({ pr, onOpen }: { pr: PrDetail; onOpen: () => void }) {
  const [owner, name] = pr.repository.split('/');
  const ghHref = `https://github.com/${owner}/${name}/pull/${pr.pullRequestNumber}`;
  const stateColor = pr.prState === 'MERGED' ? 'done.fg' : pr.prState === 'OPEN' ? 'success.fg' : 'danger.fg';
  const stateColorVar = pr.prState === 'MERGED'
    ? 'var(--done-fg)'
    : pr.prState === 'OPEN'
      ? 'var(--success-fg)'
      : 'var(--danger-fg)';
  const StateIcon = pr.prState === 'MERGED' ? GitMergeIcon : pr.prState === 'OPEN' ? GitPullRequestIcon : GitPullRequestClosedIcon;
  const scoreDisplay = pr.realScore > 0 ? pr.realScore.toFixed(2) : pr.collateralScore > 0 ? pr.collateralScore.toFixed(2) : '—';
  const stateLabel = pr.prState === 'MERGED' ? 'Merged' : pr.prState === 'OPEN' ? 'Opened' : 'Closed';
  const ttmMs = pr.prState === 'MERGED' && pr.mergedAt
    ? Date.parse(pr.mergedAt) - Date.parse(pr.prCreatedAt)
    : null;
  const lifetimeText = ttmMs != null && Number.isFinite(ttmMs) ? `in ${fmtDuration(ttmMs)}` : null;
  // Base score (tokenScore) only shown when time-decay materially reduced it.
  const showBaseScore = pr.realScore > 0 && pr.tokenScore > pr.realScore * 1.05;
  const earnedUsdPerDay = pr.earnedScore != null && pr.realScore > 0 && pr.predictedUsdPerDay > 0
    ? (pr.earnedScore / pr.realScore) * pr.predictedUsdPerDay
    : null;
  const showEarnedDiff = earnedUsdPerDay != null && pr.predictedUsdPerDay > 0
    && Math.abs(earnedUsdPerDay - pr.predictedUsdPerDay) / pr.predictedUsdPerDay >= 0.05;
  const openAgeMs = pr.prState === 'OPEN' ? Date.now() - Date.parse(pr.prCreatedAt) : null;
  const staleness: { label: string; color: string } | null = openAgeMs == null
    ? null
    : openAgeMs > 30 * 86_400_000
    ? { label: 'stale', color: 'var(--danger-fg)' }
    : openAgeMs > 7 * 86_400_000
    ? { label: 'aging', color: 'var(--attention-fg)' }
    : null;
  const fmtAbsDate = (iso: string) => {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return iso;
    return new Date(t).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };
  const absoluteDate = fmtAbsDate(pr.prState === 'MERGED' && pr.mergedAt ? pr.mergedAt : pr.prCreatedAt);
  const absoluteOpenedDate = fmtAbsDate(pr.prCreatedAt);
  const linkedIssues = parseLinkedIssues(pr.linkedIssues, pr.repository);

  const linkedIssueChips = linkedIssues.length > 0 && (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', mt: '2px', flexWrap: 'wrap', minWidth: 0 }}>
      <Text sx={{ fontSize: '10px', color: 'fg.subtle' }}>closes</Text>
      {linkedIssues.slice(0, 3).map((iss) => (
        <Box
          key={iss.num}
          as="a"
          href={iss.href}
          target="_blank"
          rel="noreferrer"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          title={`${pr.repository}${iss.label}`}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            ...MONO,
            fontSize: '10px',
            fontWeight: 600,
            color: 'success.fg',
            textDecoration: 'none',
            px: '4px',
            py: '1px',
            borderRadius: '3px',
            border: '1px solid',
            borderColor: 'border.muted',
            bg: 'canvas.subtle',
            transition: 'border-color 100ms, color 100ms',
            '&:hover': { borderColor: 'success.emphasis', color: 'success.emphasis' },
          }}
        >
          <IssueOpenedIcon size={9} /> {iss.label}
        </Box>
      ))}
      {linkedIssues.length > 3 && (
        <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.subtle' }} title={linkedIssues.map((i) => i.label).join(', ')}>
          +{linkedIssues.length - 3}
        </Text>
      )}
    </Box>
  );

  const titleButton = (
    <Box
      as="button"
      onClick={onOpen}
      title={pr.title}
      sx={{
        flex: 1,
        minWidth: 0,
        textAlign: 'left',
        color: 'fg.default',
        fontSize: 0,
        fontWeight: 600,
        border: 'none',
        bg: 'transparent',
        fontFamily: 'inherit',
        cursor: 'pointer',
        p: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        '&:hover': { textDecoration: 'underline' },
      }}
    >
      {pr.title}
    </Box>
  );

  const githubLink = (
    <Box
      as="a"
      href={ghHref}
      target="_blank"
      rel="noreferrer"
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      sx={{ color: 'fg.muted', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', '&:hover': { color: 'fg.default' } }}
      aria-label="Open on GitHub"
    >
      <LinkExternalIcon size={11} />
    </Box>
  );

  const diffNumbers = (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', ...MONO, fontSize: '10px' }}>
      <Text sx={{ color: 'success.fg' }}>+{pr.additions.toLocaleString()}</Text>
      <Text sx={{ color: 'danger.fg' }}>−{pr.deletions.toLocaleString()}</Text>
    </Box>
  );

  return (
    <Box
      sx={{
        borderBottom: '1px solid',
        borderColor: 'border.muted',
        '&:last-of-type': { borderBottom: 'none' },
        '&:hover': { bg: 'canvas.default' },
        transition: 'background-color 100ms',
      }}
    >
      {/* ── Mobile card (hidden on desktop) ──────────────────────────── */}
      <Box sx={{ display: ['flex', null, 'none'], flexDirection: 'column', gap: '6px', px: 2, py: '10px' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '8px', minWidth: 0 }}>
          <Box sx={{ color: stateColor, display: 'inline-flex', mt: '2px', flexShrink: 0 }}>
            <StateIcon size={13} />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '6px', minWidth: 0 }}>
              {titleButton}
              {pr.label && (
                <Label variant="default" sx={{ fontSize: '10px', flexShrink: 0 }}>{pr.label}</Label>
              )}
            </Box>
            {linkedIssueChips}
          </Box>
          <Box sx={{ flexShrink: 0 }}>{githubLink}</Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap', pl: '21px' }}>
          <PrSizeChip additions={pr.additions} deletions={pr.deletions} variant="full" />
          <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>
            {pr.repository}#{pr.pullRequestNumber}
          </Text>
          {pr.commitCount > 0 && (
            <>
              <Text sx={{ color: 'fg.subtle' }}>·</Text>
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                <Box sx={{ color: 'fg.subtle', display: 'inline-flex' }}><GitCommitIcon size={10} /></Box>
                <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>
                  {pr.commitCount} commit{pr.commitCount === 1 ? '' : 's'}
                </Text>
              </Box>
            </>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', pl: '21px' }}>
          {diffNumbers}
          <DiffBar additions={pr.additions} deletions={pr.deletions} />
          <Text sx={{ color: 'fg.subtle' }}>·</Text>
          <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>
            score <Box as="span" sx={{ ...MONO, fontWeight: 700, color: 'fg.default' }}>{scoreDisplay}</Box>
          </Text>
          <Text sx={{ color: 'fg.subtle' }}>·</Text>
          <Text
            sx={{ ...MONO, fontSize: '10px', fontWeight: 700 }}
            style={{ color: pr.predictedUsdPerDay > 0 ? 'var(--success-fg)' : 'var(--fg-muted)' }}
          >
            {pr.predictedUsdPerDay > 0 ? `${formatUsd(pr.predictedUsdPerDay, { style: 'compact' })}/d` : '—'}
          </Text>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap', pl: '21px' }}
             title={`${stateLabel}${lifetimeText ? ' · ' + lifetimeText : ''} · opened ${absoluteOpenedDate}`}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <Box aria-hidden sx={{ width: 6, height: 6, borderRadius: 999, flexShrink: 0 }} style={{ backgroundColor: stateColorVar }} />
            <Text sx={{ fontWeight: 700, fontSize: 0, lineHeight: 1 }} style={{ color: stateColorVar }}>{stateLabel}</Text>
            {lifetimeText && (
              <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted', fontWeight: 400, lineHeight: 1 }}>{lifetimeText}</Text>
            )}
          </Box>
          <Text sx={{ color: 'fg.subtle' }}>·</Text>
          <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>
            opened {formatRelativeTime(pr.prCreatedAt)}
          </Text>
          {staleness && (
            <Text
              sx={{ ...MONO, fontSize: '9px', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}
              style={{ color: staleness.color }}
            >
              · {staleness.label}
            </Text>
          )}
        </Box>
      </Box>

      {/* ── Desktop grid row (hidden on mobile) ──────────────────────── */}
      <Box
        sx={{
          display: ['none', null, 'grid'],
          gridTemplateColumns: PR_COLS,
          alignItems: 'center',
          gap: 2,
          px: 3,
          py: '8px',
          minHeight: 52,
        }}
      >
        <Box sx={{ color: stateColor, display: 'inline-flex' }}>
          <StateIcon size={13} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '6px', minWidth: 0 }}>
            {titleButton}
            {pr.label && <Label variant="default" sx={{ fontSize: '10px', flexShrink: 0 }}>{pr.label}</Label>}
          </Box>
          {linkedIssueChips}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
          <PrSizeChip additions={pr.additions} deletions={pr.deletions} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <Text
            sx={{ ...MONO, fontSize: '10px', color: 'fg.muted', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
            title={`${pr.repository}#${pr.pullRequestNumber}`}
          >
            {pr.repository}#{pr.pullRequestNumber}
          </Text>
        </Box>
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}
          title={pr.commitCount > 0 ? `${pr.commitCount} commit${pr.commitCount === 1 ? '' : 's'}` : undefined}
        >
          {pr.commitCount > 0 ? (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
              <Box sx={{ color: 'fg.subtle', display: 'inline-flex' }}><GitCommitIcon size={10} /></Box>
              <Text sx={{ ...MONO, fontSize: '11px', color: 'fg.default', fontWeight: 600 }}>{pr.commitCount}</Text>
            </Box>
          ) : (
            <Text sx={{ ...MONO, fontSize: '11px', color: 'fg.subtle' }}>—</Text>
          )}
        </Box>
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}
          title={`+${pr.additions.toLocaleString()} additions · −${pr.deletions.toLocaleString()} deletions`}
        >
          {diffNumbers}
          <DiffBar additions={pr.additions} deletions={pr.deletions} />
        </Box>
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}
          title={showBaseScore ? `Score ${scoreDisplay} · base ${pr.tokenScore.toFixed(2)} (time-decayed)` : `Score ${scoreDisplay}`}
        >
          <Text sx={{ ...MONO, fontSize: 0, fontWeight: 700, lineHeight: 1 }}>
            {scoreDisplay}
            {showBaseScore && (
              <Box as="span" sx={{ ...MONO, fontSize: '9px', fontWeight: 400, color: 'fg.subtle', ml: '3px' }}>
                /{pr.tokenScore.toFixed(0)}
              </Box>
            )}
          </Text>
        </Box>
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}
          title={showEarnedDiff && earnedUsdPerDay != null
            ? `Predicted ${formatUsd(pr.predictedUsdPerDay)}/d · earned ${formatUsd(earnedUsdPerDay)}/d`
            : `Predicted ${formatUsd(pr.predictedUsdPerDay)}/d`}
        >
          <Text
            sx={{ ...MONO, fontSize: 0, fontWeight: 700, lineHeight: 1 }}
            style={{ color: pr.predictedUsdPerDay > 0 ? 'var(--success-fg)' : 'var(--fg-muted)' }}
          >
            {pr.predictedUsdPerDay > 0 ? formatUsd(pr.predictedUsdPerDay, { style: 'compact' }) : '—'}
            {showEarnedDiff && earnedUsdPerDay != null && earnedUsdPerDay > 0 && (
              <Box as="span" sx={{ ...MONO, fontSize: '9px', fontWeight: 400, color: 'fg.subtle', ml: '3px' }}>
                /{formatUsd(earnedUsdPerDay, { style: 'compact' })}
              </Box>
            )}
          </Text>
        </Box>
        <Box
          sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', whiteSpace: 'nowrap' }}
          title={`${stateLabel}${lifetimeText ? ' · ' + lifetimeText : ''} · ${absoluteDate}`}
        >
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <Box aria-hidden sx={{ width: 6, height: 6, borderRadius: 999, flexShrink: 0 }} style={{ backgroundColor: stateColorVar }} />
            <Text sx={{ fontWeight: 700, fontSize: 0, lineHeight: 1 }} style={{ color: stateColorVar }}>{stateLabel}</Text>
          </Box>
          {lifetimeText && (
            <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted', fontWeight: 400, lineHeight: 1 }}>{lifetimeText}</Text>
          )}
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1px', whiteSpace: 'nowrap' }}
             title={absoluteOpenedDate}>
          <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted', lineHeight: 1 }}>{formatRelativeTime(pr.prCreatedAt)}</Text>
          {staleness && (
            <Text
              sx={{ ...MONO, fontSize: '9px', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase', lineHeight: 1 }}
              style={{ color: staleness.color }}
              title={`Open for ${openAgeMs ? fmtDuration(openAgeMs) : '?'} — this PR is ${staleness.label}`}
            >
              {staleness.label}
            </Text>
          )}
        </Box>
        {githubLink}
      </Box>
    </Box>
  );
}

function PrModal({ pr, onClose }: { pr: PrDetail; onClose: () => void }) {
  const [owner, name] = pr.repository.split('/');
  const ghHref = `https://github.com/${owner}/${name}/pull/${pr.pullRequestNumber}`;
  const stateColor = pr.prState === 'MERGED' ? 'done.fg' : pr.prState === 'OPEN' ? 'success.fg' : 'danger.fg';
  const StateIcon = pr.prState === 'MERGED' ? GitMergeIcon : pr.prState === 'OPEN' ? GitPullRequestIcon : GitPullRequestClosedIcon;
  const daysSinceCreated = Math.max(0, (Date.now() - Date.parse(pr.prCreatedAt)) / 86_400_000);
  const decayValue = pr.timeDecayMultiplier ?? decayAt(daysSinceCreated);
  const decayPct = Math.round(decayValue * 100);
  const dateLabel = pr.prState === 'MERGED' ? 'Merged' : pr.prState === 'CLOSED' ? 'Closed' : 'Opened';
  const dateValue = pr.prState === 'MERGED' && pr.mergedAt ? formatRelativeTime(pr.mergedAt) : formatRelativeTime(pr.prCreatedAt);
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <Box
      sx={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: ['flex-end', null, 'center'], justifyContent: 'center', p: [0, null, 3] }}
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <Box
        sx={{
          bg: 'canvas.default',
          borderRadius: ['12px 12px 0 0', null, 2],
          border: '1px solid',
          borderColor: 'border.default',
          maxWidth: 560,
          width: '100%',
          maxHeight: ['85vh', null, '90vh'],
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
        style={{ boxShadow: '0 24px 48px -12px rgba(0,0,0,0.55)' }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <Box
          sx={{
            px: 3, pt: 3, pb: 2,
            display: 'flex', alignItems: 'flex-start', gap: 2,
            borderBottom: '1px solid', borderColor: 'border.muted',
            position: 'sticky', top: 0, bg: 'canvas.default', zIndex: 1,
          }}
        >
          <Box sx={{ color: stateColor, display: 'inline-flex', mt: '3px', flexShrink: 0 }}>
            <StateIcon size={16} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Text id={titleId} sx={{ display: 'block', fontSize: 2, fontWeight: 700, color: 'fg.default', lineHeight: 1.3, letterSpacing: '-0.01em' }}>
              {pr.title}
            </Text>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mt: '4px', flexWrap: 'wrap' }}>
              <Text sx={{ ...MONO, fontSize: 0, color: 'fg.muted' }}>{pr.repository}#{pr.pullRequestNumber}</Text>
              {pr.label && (
                <>
                  <Text sx={{ color: 'fg.subtle' }}>·</Text>
                  <Label variant="default" sx={{ fontSize: 0 }}>{pr.label}</Label>
                </>
              )}
            </Box>
          </Box>
          <Box
            as="button"
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="Close"
            sx={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28,
              border: '1px solid', borderColor: 'border.default', borderRadius: '50%',
              bg: 'canvas.subtle', color: 'fg.muted',
              cursor: 'pointer', flexShrink: 0,
              '&:hover': { bg: 'canvas.inset', color: 'fg.default' },
            }}
          >
            <XIcon size={12} />
          </Box>
        </Box>

        <Box sx={{ px: 3, py: 2, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', borderBottom: '1px solid', borderColor: 'border.muted' }}>
          <Metric label="Changes" value={
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
              <span style={{ color: 'var(--success-fg)' }}>+{pr.additions.toLocaleString()}</span>
              <span style={{ color: 'var(--fg-subtle)' }}>/</span>
              <span style={{ color: 'var(--danger-fg)' }}>−{pr.deletions.toLocaleString()}</span>
            </span>
          } sub={`${pr.commitCount} commit${pr.commitCount !== 1 ? 's' : ''}`} />
          <Metric label="Score" value={pr.realScore > 0 ? pr.realScore.toFixed(3) : pr.collateralScore > 0 ? pr.collateralScore.toFixed(3) : '—'}
            sub={pr.earnedScore != null ? `${pr.earnedScore.toFixed(3)} earned` : pr.score > 0 ? `${pr.score.toFixed(3)} live` : 'pending'} />
          <Metric label="$/Day" value={pr.predictedUsdPerDay > 0 ? formatUsd(pr.predictedUsdPerDay, { style: 'compact' }) : '—'} sub="predicted" tone="success" />
          <Metric label={dateLabel} value={dateValue} sub={pr.prState === 'MERGED' && pr.mergedAt ? pr.mergedAt.slice(0, 10) : pr.prCreatedAt.slice(0, 10)} />
          <Metric label="Time decay" value={`${decayPct}%`} sub={decayPct >= 80 ? 'fresh' : decayPct >= 40 ? 'aging' : 'stale'} />
          <Metric label="State" value={pr.prState} sub={pr.prState === 'OPEN' ? 'in review' : pr.prState === 'MERGED' ? 'merged' : 'closed'} tone={pr.prState === 'MERGED' ? 'done' : pr.prState === 'OPEN' ? 'success' : 'danger'} />
        </Box>

        <Box sx={{ px: 3, pt: 2, pb: 1 }}>
          <Text sx={{ ...LABEL, mb: 1, display: 'block' }}>Time-decay curve</Text>
          <MiniDecayChart daysSinceCreated={daysSinceCreated} currentDecay={decayValue} />
        </Box>

        <Box sx={{ px: 3, py: 2, display: 'flex', justifyContent: 'center' }}>
          <Box
            as="a"
            href={ghHref}
            target="_blank"
            rel="noreferrer"
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 1,
              px: 3, py: '8px',
              border: '1px solid', borderColor: 'border.default', borderRadius: 2,
              bg: 'canvas.subtle', color: 'fg.default', fontSize: 1, fontWeight: 600, textDecoration: 'none',
              '&:hover': { bg: 'canvas.inset', borderColor: 'border.muted' },
            }}
          >
            <MarkGithubIcon size={14} /> View on GitHub <LinkExternalIcon size={12} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function MiniDecayChart({ daysSinceCreated, currentDecay }: { daysSinceCreated: number; currentDecay: number }) {
  const VW = 480, VH = 88;
  const PL = 28, PR = 12, PT = 8, PB = 22;
  const innerW = VW - PL - PR;
  const innerH = VH - PT - PB;
  const DAYS = 30;
  const GRACE = DECAY_PARAMS.graceHours / 24;
  const xScale = (d: number) => PL + Math.min(d / DAYS, 1) * innerW;
  const yScale = (v: number) => PT + (1 - v) * innerH;
  const N = 120;
  const pts: string[] = [];
  for (let i = 0; i <= N; i++) {
    const d = (i / N) * DAYS;
    pts.push(`${xScale(d).toFixed(1)},${yScale(decayAt(d)).toFixed(1)}`);
  }
  const curvePath = `M ${pts.join(' L ')}`;
  const fillPath = `${curvePath} L ${xScale(DAYS).toFixed(1)},${(PT + innerH).toFixed(1)} L ${PL},${(PT + innerH).toFixed(1)} Z`;
  const nowDays = Math.min(daysSinceCreated, DAYS);
  const nowX = xScale(nowDays);
  const nowY = yScale(Math.max(DECAY_PARAMS.floor, Math.min(1, currentDecay)));
  const xTicks = [0, 7, 14, 21, 30];

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ display: 'block', width: '100%', height: 'auto' }} aria-hidden>
      <rect x={PL} y={PT} width={innerW} height={innerH} fill="var(--bg-muted, #0d1117)" rx={3} />
      <rect x={PL} y={PT} width={xScale(GRACE) - PL} height={innerH} fill="var(--success-fg)" opacity={0.12} />
      {[0, 0.25, 0.5, 0.75, 1.0].map((v) => (
        <line key={v} x1={PL} y1={yScale(v)} x2={PL + innerW} y2={yScale(v)} stroke="var(--border-muted)" strokeWidth={0.5} />
      ))}
      <path d={fillPath} fill="var(--accent-fg)" opacity={0.12} />
      <path d={curvePath} fill="none" stroke="var(--accent-fg)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <line x1={PL} y1={yScale(DECAY_PARAMS.floor)} x2={PL + innerW} y2={yScale(DECAY_PARAMS.floor)}
            stroke="var(--fg-muted)" strokeWidth={0.75} strokeDasharray="3 3" opacity={0.5} />
      {daysSinceCreated < DAYS && (
        <line x1={nowX} y1={PT} x2={nowX} y2={PT + innerH} stroke="var(--fg-default)" strokeWidth={1} strokeDasharray="3 2" opacity={0.5} />
      )}
      <circle cx={nowX} cy={nowY} r={4} fill="var(--accent-fg)" />
      <circle cx={nowX} cy={nowY} r={1.6} fill="white" />
      {xTicks.map((d) => (
        <text key={d} x={xScale(d)} y={VH - 5} fontSize={8} fill="var(--fg-muted)"
              textAnchor={d === 0 ? 'start' : d === 30 ? 'end' : 'middle'} fontFamily="monospace">
          {d}d
        </text>
      ))}
      {[0, 0.5, 1.0].map((v) => (
        <text key={v} x={PL - 4} y={yScale(v) + 3} fontSize={8} fill="var(--fg-muted)" textAnchor="end" fontFamily="monospace">
          {Math.round(v * 100)}%
        </text>
      ))}
    </svg>
  );
}
