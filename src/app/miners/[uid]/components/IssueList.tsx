'use client';

import React, { useEffect, useState } from 'react';
import { Box, Text, Label } from '@primer/react';
import {
  IssueOpenedIcon, IssueClosedIcon, SkipIcon,
  CommentDiscussionIcon, LinkExternalIcon, GitPullRequestIcon,
  MarkGithubIcon, XIcon,
} from '@primer/octicons-react';
import { formatUsd, formatRelativeTime } from '@/lib/format';
import {
  Card, CardHeader, Metric, SearchBox, RowSizeSelector, PageNav, MONO, LABEL,
} from '../../components';
import { useSearchPage } from './shared';
import type { IssueDetail, RepoEval } from './types';

export interface IssueListProps {
  issues: IssueDetail[];
  title: string;
  sub?: string;
  /** Disambiguates row keys when the same issue appears in both lists. */
  kind: 'discovered' | 'solved';
  icon: React.ReactNode;
  discScoreScale?: number;
  discEarnScale?: number;
  repoEvalMap?: Map<string, RepoEval>;
}

const ISSUE_COLS = 'auto minmax(0, 1fr) minmax(140px, 180px) 56px 64px 72px 100px 100px 20px';

function IssueHdrLabel({ children, align = 'right' }: { children: string; align?: 'left' | 'right' }) {
  return (
    <Text sx={{ ...LABEL, color: 'fg.muted', textAlign: align, px: '4px', userSelect: 'none' }}>
      {children}
    </Text>
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

export function IssueList({
  issues, title, sub, kind, icon,
  discScoreScale = 0, discEarnScale = 0, repoEvalMap,
}: IssueListProps) {
  const [modalIss, setModalIss] = useState<IssueDetail | null>(null);
  const [pageSize, setPageSize] = useState(25);
  const { search, setSearch, page, setPage, filtered, paged: shown } = useSearchPage(
    issues,
    (iss, q) => iss.title.toLowerCase().includes(q) || iss.repo.toLowerCase().includes(q),
    pageSize,
  );
  useEffect(() => { setPage(0); }, [issues, setPage]);

  if (issues.length === 0) return null;

  return (
    <>
    <Card>
      <CardHeader
        icon={icon}
        title={title}
        sub={sub}
        right={
          <>
            <RowSizeSelector
              value={pageSize}
              onChange={(n) => { setPageSize(n); setPage(0); }}
              showAll={false}
            />
            <SearchBox value={search} onChange={setSearch} placeholder="Search issues…" />
          </>
        }
      />
      <Box>
        <Box
          sx={{
            display: ['none', null, 'grid'],
            gridTemplateColumns: ISSUE_COLS,
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
          <IssueHdrLabel align="left">Title</IssueHdrLabel>
          <IssueHdrLabel align="left">Repo</IssueHdrLabel>
          <IssueHdrLabel align="right">Comments</IssueHdrLabel>
          <IssueHdrLabel align="right">Score</IssueHdrLabel>
          <IssueHdrLabel align="right">$/Day</IssueHdrLabel>
          <IssueHdrLabel align="right">Status</IssueHdrLabel>
          <IssueHdrLabel align="right">Opened</IssueHdrLabel>
          <span />
        </Box>
        {shown.map((iss) => (
          <IssueRow
            key={`${kind}-${iss.repo}#${iss.number}`}
            iss={iss}
            discScoreScale={discScoreScale}
            discEarnScale={discEarnScale}
            repoEvalMap={repoEvalMap}
            onOpen={() => setModalIss(iss)}
          />
        ))}
        {filtered.length === 0 && (
          <Box sx={{ py: 4, textAlign: 'center', color: 'fg.muted', fontSize: 0 }}>
            No issues match &ldquo;{search}&rdquo;
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
    {modalIss && (
      <IssueModal
        iss={modalIss}
        discScoreScale={discScoreScale}
        discEarnScale={discEarnScale}
        repoEvalMap={repoEvalMap}
        onClose={() => setModalIss(null)}
      />
    )}
    </>
  );
}

// `closedByPrs` is "#42, #57" (short) or full GitHub PR URLs; parser handles both.
interface LinkedPr { href: string; label: string; full: string }
function parseLinkedPrs(raw: string | null, fallbackRepo: string): LinkedPr[] {
  if (!raw) return [];
  const out: LinkedPr[] = [];
  for (const part of raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)) {
    // "#42" — most common server-side format. Resolve via the issue's own repo.
    const shortMatch = part.match(/^#(\d+)$/);
    if (shortMatch) {
      const num = shortMatch[1];
      out.push({
        href: `https://github.com/${fallbackRepo}/pull/${num}`,
        label: `#${num}`,
        full: `${fallbackRepo}#${num}`,
      });
      continue;
    }
    const urlMatch = part.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
    if (urlMatch) {
      const [, owner, repo, num] = urlMatch;
      out.push({
        href: `https://github.com/${owner}/${repo}/pull/${num}`,
        label: `#${num}`,
        full: `${owner}/${repo}#${num}`,
      });
      continue;
    }
    const refMatch = part.match(/^([^/]+\/[^#]+)#(\d+)$/);
    if (refMatch) {
      const [, repo, num] = refMatch;
      out.push({
        href: `https://github.com/${repo}/pull/${num}`,
        label: `#${num}`,
        full: `${repo}#${num}`,
      });
      continue;
    }
    out.push({ href: part.startsWith('http') ? part : `https://${part}`, label: part, full: part });
  }
  return out;
}

function IssueRow({
  iss, discScoreScale, discEarnScale, repoEvalMap, onOpen,
}: {
  iss: IssueDetail;
  discScoreScale: number;
  discEarnScale: number;
  repoEvalMap?: Map<string, RepoEval>;
  onOpen: () => void;
}) {
  const stateColorSx =
    iss.bucket === 'solved' || iss.bucket === 'completed' ? 'done.fg'
    : iss.bucket === 'open' ? 'success.fg'
    : 'danger.fg';
  const stateColorVar =
    iss.bucket === 'solved' || iss.bucket === 'completed' ? 'var(--done-fg)'
    : iss.bucket === 'open' ? 'var(--success-fg)'
    : 'var(--danger-fg)';
  const StateIcon =
    iss.bucket === 'open' ? IssueOpenedIcon
    : iss.bucket === 'closed' ? SkipIcon
    : IssueClosedIcon;
  const stateLabel =
    iss.bucket === 'solved' ? 'Solved'
    : iss.bucket === 'completed' ? 'Completed'
    : iss.bucket === 'open' ? 'Open'
    : 'Closed';

  const ttcMs = iss.closedAt && iss.createdAt
    ? Date.parse(iss.closedAt) - Date.parse(iss.createdAt)
    : null;
  const lifetimeText = ttcMs != null && Number.isFinite(ttcMs) && ttcMs >= 0
    ? `in ${fmtDuration(ttcMs)}`
    : null;

  const repoEligible = !!repoEvalMap?.get(iss.repo.toLowerCase())?.isIssueEligible;
  const earningEligible = iss.bucket === 'solved' && repoEligible;
  const issueScore = earningEligible ? discScoreScale : 0;
  const issueUsdPerDay = earningEligible ? discEarnScale : 0;

  const href = iss.htmlUrl ?? `https://github.com/${iss.repo}/issues/${iss.number}`;
  const linkedPrs = parseLinkedPrs(iss.closedByPrs, iss.repo);

  const titleButton = (
    <Box
      as="button"
      onClick={onOpen}
      title={iss.title}
      sx={{
        display: 'block',
        width: '100%',
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
      {iss.title}
    </Box>
  );

  const linkedPrChips = linkedPrs.length > 0 && (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', mt: '2px', flexWrap: 'wrap', minWidth: 0 }}>
      <Text sx={{ fontSize: '10px', color: 'fg.subtle' }}>closed by</Text>
      {linkedPrs.slice(0, 3).map((pr) => (
        <Box
          key={pr.full}
          as="a"
          href={pr.href}
          target="_blank"
          rel="noreferrer"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          title={pr.full}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            ...MONO,
            fontSize: '10px',
            fontWeight: 600,
            color: 'accent.fg',
            textDecoration: 'none',
            px: '4px',
            py: '1px',
            borderRadius: '3px',
            border: '1px solid',
            borderColor: 'border.muted',
            bg: 'canvas.subtle',
            transition: 'border-color 100ms, color 100ms',
            '&:hover': { borderColor: 'accent.emphasis', color: 'accent.emphasis' },
          }}
        >
          <GitPullRequestIcon size={9} /> {pr.label}
        </Box>
      ))}
      {linkedPrs.length > 3 && (
        <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.subtle' }} title={linkedPrs.map((p) => p.full).join(', ')}>
          +{linkedPrs.length - 3}
        </Text>
      )}
    </Box>
  );

  const githubLink = (
    <Box
      as="a"
      href={href}
      target="_blank"
      rel="noreferrer"
      sx={{
        color: 'fg.muted',
        textDecoration: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        '&:hover': { color: 'fg.default' },
      }}
      aria-label="Open on GitHub"
    >
      <LinkExternalIcon size={11} />
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
      {/* ── Mobile card (hidden on desktop) ──────────────────────── */}
      <Box sx={{ display: ['flex', null, 'none'], flexDirection: 'column', gap: '6px', px: 2, py: '10px' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '8px', minWidth: 0 }}>
          <Box sx={{ color: stateColorSx, display: 'inline-flex', mt: '2px', flexShrink: 0 }}>
            <StateIcon size={13} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {titleButton}
            {linkedPrChips}
          </Box>
          <Box sx={{ flexShrink: 0 }}>{githubLink}</Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap', pl: '21px' }}>
          <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>{iss.repo}#{iss.number}</Text>
          {iss.comments > 0 && (
            <>
              <Text sx={{ color: 'fg.subtle' }}>·</Text>
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                <Box sx={{ color: 'fg.subtle', display: 'inline-flex' }}><CommentDiscussionIcon size={10} /></Box>
                <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>{iss.comments}</Text>
              </Box>
            </>
          )}
          <Text sx={{ color: 'fg.subtle' }}>·</Text>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <Box aria-hidden sx={{ width: 6, height: 6, borderRadius: 999 }} style={{ backgroundColor: stateColorVar }} />
            <Text sx={{ fontWeight: 700, fontSize: 0, lineHeight: 1 }} style={{ color: stateColorVar }}>{stateLabel}</Text>
            {lifetimeText && (
              <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>{lifetimeText}</Text>
            )}
          </Box>
          {iss.createdAt && (
            <>
              <Text sx={{ color: 'fg.subtle' }}>·</Text>
              <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>opened {formatRelativeTime(iss.createdAt)}</Text>
            </>
          )}
        </Box>
        {earningEligible && (issueScore > 0 || issueUsdPerDay > 0) && (
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', pl: '21px' }}>
            <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted' }}>
              score <Box as="span" sx={{ ...MONO, fontWeight: 700, color: 'fg.default' }}>{issueScore.toFixed(2)}</Box>
            </Text>
            <Text sx={{ color: 'fg.subtle' }}>·</Text>
            <Text
              sx={{ ...MONO, fontSize: '10px', fontWeight: 700 }}
              style={{ color: 'var(--success-fg)' }}
            >
              {formatUsd(issueUsdPerDay, { style: 'compact' })}/d
            </Text>
          </Box>
        )}
      </Box>

      {/* ── Desktop grid row (hidden on mobile) ──────────────────── */}
      <Box
        sx={{
          display: ['none', null, 'grid'],
          gridTemplateColumns: ISSUE_COLS,
          alignItems: 'center',
          gap: 2,
          px: 3,
          py: '8px',
          minHeight: 52,
        }}
      >
        <Box sx={{ color: stateColorSx, display: 'inline-flex' }}>
          <StateIcon size={13} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          {titleButton}
          {linkedPrChips}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Text
            sx={{
              ...MONO,
              fontSize: '10px',
              color: 'fg.muted',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={`${iss.repo}#${iss.number}`}
          >
            {iss.repo}#{iss.number}
          </Text>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}
             title={iss.comments > 0 ? `${iss.comments} comment${iss.comments === 1 ? '' : 's'}` : undefined}>
          {iss.comments > 0 ? (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
              <Box sx={{ color: 'fg.subtle', display: 'inline-flex' }}><CommentDiscussionIcon size={10} /></Box>
              <Text sx={{ ...MONO, fontSize: '11px', color: 'fg.default', fontWeight: 600 }}>{iss.comments}</Text>
            </Box>
          ) : (
            <Text sx={{ ...MONO, fontSize: '11px', color: 'fg.subtle' }}>—</Text>
          )}
        </Box>
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}
          title={earningEligible
            ? `This issue contributes ${issueScore.toFixed(3)} to the discovery score pool`
            : iss.bucket !== 'solved'
              ? 'Only solved issues earn from the discovery pool'
              : 'Repo is not issue-eligible'}
        >
          {issueScore > 0 ? (
            <Text sx={{ ...MONO, fontSize: 0, fontWeight: 700, lineHeight: 1 }}>
              {issueScore.toFixed(2)}
            </Text>
          ) : (
            <Text sx={{ ...MONO, fontSize: '11px', color: 'fg.subtle' }}>—</Text>
          )}
        </Box>
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}
          title={earningEligible
            ? `Predicted ${formatUsd(issueUsdPerDay)}/d from this issue`
            : 'No earning from this issue'}
        >
          {issueUsdPerDay > 0 ? (
            <Text
              sx={{ ...MONO, fontSize: 0, fontWeight: 700, lineHeight: 1 }}
              style={{ color: 'var(--success-fg)' }}
            >
              {formatUsd(issueUsdPerDay, { style: 'compact' })}
            </Text>
          ) : (
            <Text sx={{ ...MONO, fontSize: '11px', color: 'fg.subtle' }}>—</Text>
          )}
        </Box>
        <Box
          sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', whiteSpace: 'nowrap' }}
          title={`${stateLabel}${lifetimeText ? ' · ' + lifetimeText : ''}`}
        >
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <Box aria-hidden sx={{ width: 6, height: 6, borderRadius: 999, flexShrink: 0 }} style={{ backgroundColor: stateColorVar }} />
            <Text sx={{ fontWeight: 700, fontSize: 0, lineHeight: 1 }} style={{ color: stateColorVar }}>{stateLabel}</Text>
          </Box>
          {lifetimeText && (
            <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted', fontWeight: 400, lineHeight: 1 }}>{lifetimeText}</Text>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', whiteSpace: 'nowrap' }}
             title={iss.createdAt ?? undefined}>
          {iss.createdAt ? (
            <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.muted', lineHeight: 1 }}>
              {formatRelativeTime(iss.createdAt)}
            </Text>
          ) : (
            <Text sx={{ ...MONO, fontSize: '10px', color: 'fg.subtle' }}>—</Text>
          )}
        </Box>
        {githubLink}
      </Box>
    </Box>
  );
}

function IssueModal({
  iss, discScoreScale, discEarnScale, repoEvalMap, onClose,
}: {
  iss: IssueDetail;
  discScoreScale: number;
  discEarnScale: number;
  repoEvalMap?: Map<string, RepoEval>;
  onClose: () => void;
}) {
  const ghHref = iss.htmlUrl ?? `https://github.com/${iss.repo}/issues/${iss.number}`;
  const StateIcon =
    iss.bucket === 'open' ? IssueOpenedIcon
    : iss.bucket === 'closed' ? SkipIcon
    : IssueClosedIcon;
  const stateColor =
    iss.bucket === 'solved' || iss.bucket === 'completed' ? 'done.fg'
    : iss.bucket === 'open' ? 'success.fg'
    : 'danger.fg';
  const stateLabel =
    iss.bucket === 'solved' ? 'Solved'
    : iss.bucket === 'completed' ? 'Completed'
    : iss.bucket === 'open' ? 'Open'
    : 'Closed';
  const ttcMs = iss.closedAt && iss.createdAt
    ? Date.parse(iss.closedAt) - Date.parse(iss.createdAt)
    : null;
  const ttcText = ttcMs != null && Number.isFinite(ttcMs) && ttcMs >= 0 ? fmtDuration(ttcMs) : null;
  const repoEligible = !!repoEvalMap?.get(iss.repo.toLowerCase())?.isIssueEligible;
  const earningEligible = iss.bucket === 'solved' && repoEligible;
  const issueScore = earningEligible ? discScoreScale : 0;
  const issueUsdPerDay = earningEligible ? discEarnScale : 0;
  const linkedPrs = parseLinkedPrs(iss.closedByPrs, iss.repo);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <Box
      sx={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: ['flex-end', null, 'center'], justifyContent: 'center', p: [0, null, 3] }}
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
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
            <Text sx={{ display: 'block', fontSize: 2, fontWeight: 700, color: 'fg.default', lineHeight: 1.3, letterSpacing: '-0.01em' }}>
              {iss.title}
            </Text>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mt: '4px', flexWrap: 'wrap' }}>
              <Text sx={{ ...MONO, fontSize: 0, color: 'fg.muted' }}>{iss.repo}#{iss.number}</Text>
              <Text sx={{ color: 'fg.subtle' }}>·</Text>
              <Label
                variant={iss.bucket === 'solved' || iss.bucket === 'completed' ? 'done'
                  : iss.bucket === 'open' ? 'success' : 'danger'}
                sx={{ fontSize: 0 }}
              >
                {stateLabel}
              </Label>
            </Box>
          </Box>
          <Box
            as="button"
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
          <Metric label="Comments" value={iss.comments > 0 ? iss.comments.toLocaleString() : '—'} sub={iss.comments === 1 ? 'comment' : 'comments'} />
          <Metric
            label="Score"
            value={issueScore > 0 ? issueScore.toFixed(3) : '—'}
            sub={earningEligible ? 'discovery share' : 'not earning'}
            tone={issueScore > 0 ? 'accent' : 'neutral'}
          />
          <Metric
            label="$/Day"
            value={issueUsdPerDay > 0 ? formatUsd(issueUsdPerDay, { style: 'compact' }) : '—'}
            sub={earningEligible ? 'predicted' : 'not earning'}
            tone={issueUsdPerDay > 0 ? 'success' : 'neutral'}
          />
          <Metric
            label="Opened"
            value={iss.createdAt ? formatRelativeTime(iss.createdAt) : '—'}
            sub={iss.createdAt ? iss.createdAt.slice(0, 10) : ''}
          />
          <Metric
            label="Closed"
            value={iss.closedAt ? formatRelativeTime(iss.closedAt) : '—'}
            sub={iss.closedAt ? iss.closedAt.slice(0, 10) : iss.bucket === 'open' ? 'still open' : '—'}
            tone={iss.closedAt ? 'done' : 'neutral'}
          />
          <Metric
            label="Time to close"
            value={ttcText ?? '—'}
            sub={ttcMs != null && ttcMs >= 0 ? 'open → closed' : '—'}
          />
        </Box>

        {linkedPrs.length > 0 && (
          <Box sx={{ px: 3, py: 2, borderBottom: '1px solid', borderColor: 'border.muted' }}>
            <Text sx={{ ...LABEL, mb: 1, display: 'block' }}>Closed by</Text>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {linkedPrs.map((pr) => (
                <Box
                  key={pr.full}
                  as="a"
                  href={pr.href}
                  target="_blank"
                  rel="noreferrer"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    ...MONO,
                    fontSize: 0,
                    fontWeight: 600,
                    color: 'accent.fg',
                    textDecoration: 'none',
                    px: 2,
                    py: '4px',
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'border.default',
                    bg: 'canvas.subtle',
                    transition: 'border-color 100ms, color 100ms',
                    '&:hover': { borderColor: 'accent.emphasis', color: 'accent.emphasis' },
                  }}
                >
                  <GitPullRequestIcon size={12} /> {pr.full}
                  <LinkExternalIcon size={10} />
                </Box>
              ))}
            </Box>
          </Box>
        )}

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
