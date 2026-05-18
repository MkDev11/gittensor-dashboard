'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  XIcon,
  IssueOpenedIcon,
  GitPullRequestIcon,
  ClockIcon,
  CommentIcon,
  LinkExternalIcon,
  PersonIcon,
} from '@primer/octicons-react';
import { Box, Text, Label, Link as PrimerLink } from '@primer/react';
import Spinner from '@/components/Spinner';
import { IssueStatusBadge, PullStatusBadge } from '@/components/StatusBadge';
import { IssueLabels } from '@/components/IssueLabels';
import { formatRelativeTime } from '@/lib/format';
import { normalizeGitHubBodyMarkdown, renderMarkdownToHtml } from '@/lib/markdown';
import { useSettings } from '@/lib/settings';
import type { IssueDto, PullDto } from '@/lib/api-types';

type ContentTarget =
  | { kind: 'issue'; owner: string; name: string; number: number; preloaded?: IssueDto }
  | { kind: 'pull'; owner: string; name: string; number: number; preloaded?: PullDto };

interface ContentViewerProps {
  target: ContentTarget;
  mode: 'modal' | 'inline' | 'side';
  onClose: () => void;
  width?: number;
}

function preserveExistingBody<T extends IssueDto | PullDto>(next: T, current: T | null): T {
  const currentBody = current?.body?.trim() ? current.body : null;
  const nextHasBody = !!next.body?.trim();
  return !nextHasBody && currentBody ? { ...next, body: currentBody } : next;
}

type ActiveTab = { kind: 'issue' } | { kind: 'pull'; number: number };

export default function ContentViewer({ target, mode, onClose, width }: ContentViewerProps) {
  const { settings } = useSettings();
  const targetKey = `${target.kind}:${target.owner}/${target.name}#${target.number}`;
  const [issueData, setIssueData] = useState<IssueDto | null>(
    target.kind === 'issue' ? ((target.preloaded as IssueDto | undefined) ?? null) : null
  );
  const [pullData, setPullData] = useState<PullDto | null>(
    target.kind === 'pull' ? ((target.preloaded as PullDto | undefined) ?? null) : null
  );
  const [relatedPRs, setRelatedPRs] = useState<PullDto[]>([]);
  const [relatedPRsLoaded, setRelatedPRsLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>(
    target.kind === 'issue' ? { kind: 'issue' } : { kind: 'pull', number: target.number }
  );
  const [loading, setLoading] = useState(!target.preloaded);
  const [error, setError] = useState<string | null>(null);

  // Reset all state when the underlying target changes
  useEffect(() => {
    if (target.kind === 'issue') {
      setIssueData((target.preloaded as IssueDto | undefined) ?? null);
      setPullData(null);
      setActiveTab({ kind: 'issue' });
    } else {
      setIssueData(null);
      setPullData((target.preloaded as PullDto | undefined) ?? null);
      setActiveTab({ kind: 'pull', number: target.number });
    }
    setRelatedPRs([]);
    setRelatedPRsLoaded(false);
    setError(null);
  }, [targetKey]);

  // Always fetch the detail endpoint once per opened target. We can't trust
  // `preloaded.body` to decide whether to skip — listing endpoints sometimes
  // omit the field, sometimes set it to null explicitly (SELECT NULL as body),
  // and sometimes return real values.
  //
  // The ref does double duty: (1) "have we already initiated a fetch for this
  // target?" so the same modal doesn't refetch on parent re-renders, and
  // (2) "is the in-flight fetch's result still relevant?" by comparing the
  // captured key against the ref at resolve time. No cleanup-based cancel
  // flag — that fights StrictMode's mount/unmount/mount cycle (the second
  // mount would see ref === key and skip the new fetch, while the first
  // fetch's resolve had the cancelled flag set, leaving loading stuck true).
  const fetchedForRef = useRef<string | null>(null);
  useEffect(() => {
    const key = targetKey;
    if (fetchedForRef.current === key) return;
    fetchedForRef.current = key;

    setLoading(true);
    setError(null);
    const path =
      target.kind === 'issue'
        ? `/api/issue/${target.owner}/${target.name}/${target.number}`
        : `/api/pull/${target.owner}/${target.name}/${target.number}`;
    fetch(path)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (fetchedForRef.current !== key) return; // user moved to another target
        if (target.kind === 'issue') {
          setIssueData((current) => preserveExistingBody(j as IssueDto, current));
        } else {
          setPullData((current) => preserveExistingBody(j as PullDto, current));
        }
      })
      .catch((e) => {
        if (fetchedForRef.current !== key) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (fetchedForRef.current !== key) return;
        setLoading(false);
      });
  }, [targetKey]);

  // Fetch related PRs for issue mode (so we can show tabs)
  useEffect(() => {
    if (target.kind !== 'issue') return;
    setRelatedPRsLoaded(false);
    fetch(`/api/related-prs/${target.owner}/${target.name}/${target.number}`)
      .then((r) => r.json())
      .then((j) => setRelatedPRs(Array.isArray(j.pulls) ? (j.pulls as PullDto[]) : []))
      .catch(() => setRelatedPRs([]))
      .finally(() => setRelatedPRsLoaded(true));
  }, [targetKey]);

  useEffect(() => {
    if (mode !== 'modal') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mode, onClose]);

  // Compute what the header/body should display based on the active tab
  const showTabs = target.kind === 'issue' && relatedPRs.length > 0;
  const preloadedMergedPRCount =
    target.kind === 'issue' && typeof issueData?.merged_pr_count === 'number'
      ? issueData.merged_pr_count
      : null;
  const mergedPRCount =
    target.kind === 'issue'
      ? relatedPRsLoaded
        ? relatedPRs.filter((pr) => pr.merged === 1).length
        : preloadedMergedPRCount
      : null;
  const activePR =
    activeTab.kind === 'pull' ? relatedPRs.find((p) => p.number === activeTab.number) ?? pullData : null;

  const viewTarget: ContentTarget =
    activeTab.kind === 'issue'
      ? { kind: 'issue', owner: target.owner, name: target.name, number: target.number }
      : { kind: 'pull', owner: target.owner, name: target.name, number: activeTab.number };
  const viewData: IssueDto | PullDto | null =
    activeTab.kind === 'issue' ? issueData : activePR;

  const inner = (
    <Box
      sx={{
        bg: 'var(--bg-canvas)',
        border: mode === 'modal' ? '1px solid' : 'none',
        borderColor: 'var(--border-default)',
        borderRadius: mode === 'modal' ? 2 : 0,
        width: '100%',
        maxWidth: mode === 'modal' ? 880 : 'none',
        boxShadow: mode === 'modal' ? 'var(--shadow-overlay)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: mode === 'modal' ? 'calc(100vh - 80px)' : 'none',
      }}
    >
      <Header
        target={viewTarget}
        data={viewData}
        mergedPRCount={activeTab.kind === 'issue' ? mergedPRCount : null}
        onClose={onClose}
        showCloseIcon={mode !== 'side'}
        mode={mode}
      />
      {showTabs && (
        <TabStrip
          issueNumber={target.number}
          relatedPRs={relatedPRs}
          activeTab={activeTab}
          onChange={setActiveTab}
        />
      )}
      <Box
        sx={{
          p: 3,
          overflowY: mode === 'modal' ? 'auto' : 'visible',
          flex: 1,
        }}
      >
        {(() => {
          // viewData is preloaded from the row click but its `body` is null
          // until the detail endpoint resolves. Show the spinner whenever we
          // don't yet have a usable body — including the case where the row
          // metadata is already on screen but the body fetch is still in
          // flight — so we never flash "No description provided" first.
          const bodyMissing = !viewData?.body || (viewData.body ?? '').trim() === '';
          const stillLoading = loading && bodyMissing;
          if (stillLoading || !viewData) {
            return (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--fg-muted)' }}>
                <Spinner size="sm" tone="muted" />
                <Text>Loading…</Text>
              </Box>
            );
          }
          if (error) {
            return (
              <Box sx={{ p: 3, border: '1px solid', borderColor: 'danger.emphasis', bg: 'danger.subtle', borderRadius: 2 }}>
                <Text sx={{ color: 'danger.fg', fontWeight: 600, display: 'block', mb: 1 }}>Cannot load content</Text>
                <Text sx={{ color: 'fg.muted', fontSize: 0 }}>
                  {error}. The poller may not have cached this {target.kind} yet — try again in a few seconds.
                </Text>
              </Box>
            );
          }
          return <Body data={viewData} renderMarkdown={settings.renderMarkdown} kind={viewTarget.kind} />;
        })()}
      </Box>
    </Box>
  );

  if (mode === 'inline') {
    return (
      <Box
        sx={{
          borderTop: '1px solid',
          borderBottom: '1px solid',
          borderColor: 'var(--accent-emphasis)',
          bg: 'var(--bg-subtle)',
          animation: 'accordionExpand 200ms ease',
          '@keyframes accordionExpand': {
            from: { opacity: 0, maxHeight: 0 },
            to: { opacity: 1, maxHeight: '1200px' },
          },
        }}
      >
        {inner}
      </Box>
    );
  }

  if (mode === 'side') {
    return <SidePanel inner={inner} onClose={onClose} width={width ?? 440} />;
  }

  return (
    <Box
      onClick={onClose}
      sx={{
        position: 'fixed',
        inset: 0,
        bg: 'rgba(0, 0, 0, 0.6)',
        zIndex: 9000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        py: 4,
        overflowY: 'auto',
      }}
    >
      <Box onClick={(e: React.MouseEvent) => e.stopPropagation()} sx={{ width: '100%', mx: 3, maxWidth: 880 }}>
        {inner}
      </Box>
    </Box>
  );
}

function SidePanel({
  inner,
  onClose,
  width,
}: {
  inner: React.ReactNode;
  onClose: () => void;
  width: number;
}) {
  const [isClosing, setIsClosing] = useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const closingRef = React.useRef(false);

  const handleClose = React.useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setIsClosing(true);
    setTimeout(() => onClose(), 240);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current && panelRef.current.contains(t)) return;
      const el = e.target as HTMLElement;
      if (
        el.closest &&
        el.closest('[role="separator"], [role="listbox"], [aria-haspopup], [data-explorer-row], [data-no-close]')
      ) return;
      handleClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [handleClose]);

  return (
    <Box
      ref={panelRef as unknown as React.Ref<HTMLDivElement>}
      sx={{
        position: 'relative',
        width: '100%',
        flex: 1,
        minHeight: 0,
        bg: 'var(--bg-canvas)',
        display: 'flex',
        flexDirection: 'column',
        animation: isClosing
          ? 'slideOutRight 240ms cubic-bezier(0.4, 0, 1, 1) forwards'
          : 'slideInRight 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        '@keyframes slideInRight': {
          from: { transform: 'translateX(100%)', opacity: 0 },
          to: { transform: 'translateX(0)', opacity: 1 },
        },
        '@keyframes slideOutRight': {
          from: { transform: 'translateX(0)', opacity: 1 },
          to: { transform: 'translateX(100%)', opacity: 0 },
        },
        overflow: 'hidden',
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {inner}
      </Box>
    </Box>
  );
}

function TabStrip({
  issueNumber,
  relatedPRs,
  activeTab,
  onChange,
}: {
  issueNumber: number;
  relatedPRs: PullDto[];
  activeTab: ActiveTab;
  onChange: (next: ActiveTab) => void;
}) {
  const tabs: Array<{ key: string; isActive: boolean; onClick: () => void; node: React.ReactNode; tone: string }> = [
    {
      key: 'issue',
      isActive: activeTab.kind === 'issue',
      onClick: () => onChange({ kind: 'issue' }),
      tone: 'var(--accent-emphasis)',
      node: (
        <>
          <IssueOpenedIcon size={12} />
          <Text>Issue #{issueNumber}</Text>
        </>
      ),
    },
    ...relatedPRs.map((pr) => {
      const status = pr.merged ? 'merged' : pr.draft ? 'draft' : pr.state === 'open' ? 'open' : 'closed';
      const tone =
        status === 'merged' ? 'var(--success-emphasis)' :
        status === 'open' ? 'var(--accent-emphasis)' :
        status === 'draft' ? 'var(--fg-muted)' :
        'var(--danger-fg)';
      return {
        key: `pr-${pr.number}`,
        isActive: activeTab.kind === 'pull' && activeTab.number === pr.number,
        onClick: () => onChange({ kind: 'pull', number: pr.number }),
        tone,
        node: (
          <>
            <GitPullRequestIcon size={12} />
            <Text>PR #{pr.number}</Text>
          </>
        ),
      };
    }),
  ];

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        px: 2,
        borderBottom: '1px solid',
        borderColor: 'var(--border-default)',
        bg: 'var(--bg-subtle)',
        overflowX: 'auto',
        flexShrink: 0,
      }}
    >
      {tabs.map((t) => (
        <Box
          as="button"
          key={t.key}
          onClick={t.onClick}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            py: '8px',
            border: 'none',
            bg: 'transparent',
            color: t.isActive ? 'var(--fg-default)' : 'var(--fg-muted)',
            fontFamily: 'inherit',
            fontSize: 0,
            fontWeight: t.isActive ? 600 : 500,
            cursor: 'pointer',
            borderBottom: '2px solid',
            borderBottomColor: t.isActive ? t.tone : 'transparent',
            whiteSpace: 'nowrap',
            '&:hover': { color: 'var(--fg-default)' },
          }}
        >
          {t.node}
        </Box>
      ))}
    </Box>
  );
}

function Header({
  target,
  data,
  mergedPRCount,
  onClose,
  showCloseIcon,
  mode,
}: {
  target: ContentTarget;
  data: IssueDto | PullDto | null;
  mergedPRCount: number | null;
  onClose: () => void;
  showCloseIcon: boolean;
  mode: 'modal' | 'inline' | 'side';
}) {
  const closeButton = showCloseIcon ? (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      title="Close (Esc)"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        padding: 0,
        background: 'var(--bg-canvas)',
        border: '1px solid var(--border-default)',
        color: 'var(--fg-muted)',
        cursor: 'pointer',
        borderRadius: 6,
        transition: 'all 80ms',
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = 'var(--danger-subtle)';
        el.style.borderColor = 'var(--danger-fg)';
        el.style.color = 'var(--danger-fg)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = 'var(--bg-canvas)';
        el.style.borderColor = 'var(--border-default)';
        el.style.color = 'var(--fg-muted)';
      }}
    >
      <XIcon size={16} />
    </button>
  ) : null;
  const statusNode =
    target.kind === 'issue' ? (
      data && 'state_reason' in data ? (
        <IssueStatusBadge issue={data as IssueDto} mergedPRCount={mergedPRCount} />
      ) : (
        <IssueOpenedIcon size={16} />
      )
    ) : data ? (
      <PullStatusBadge pr={data as PullDto} />
    ) : (
      <GitPullRequestIcon size={16} />
    );
  // Derive the GitHub URL from the active tab's target rather than
  // data.html_url — guarantees the link matches the visible content
  // even if data and target ever fall out of sync during a tab switch.
  const githubHref = `https://github.com/${target.owner}/${target.name}/${target.kind === 'pull' ? 'pull' : 'issues'}/${target.number}`;
  return (
    <Box
      sx={{
        p: [2, 3],
        borderBottom: '1px solid',
        borderColor: 'var(--border-default)',
        bg: 'var(--bg-subtle)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flexWrap: 'wrap' }}>
          {mode === 'side' && closeButton}
          {statusNode}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          <a
            href={githubHref}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              border: '1px solid var(--border-default)',
              borderRadius: 6,
              background: 'var(--bg-canvas)',
              color: 'var(--fg-default)',
              fontSize: 12,
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            <LinkExternalIcon size={12} />
            GitHub
          </a>
          {mode !== 'side' && closeButton}
        </Box>
      </Box>

      <Box sx={{ minWidth: 0, mt: 2 }}>
        <Text sx={{ display: 'block', fontWeight: 600, fontSize: 2, lineHeight: 1.35, color: 'var(--fg-default)', overflowWrap: 'anywhere' }}>
          {data?.title ?? 'Loading…'}
        </Text>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap', mt: 2 }}>
          <Text sx={{ color: 'var(--fg-muted)', fontSize: 1 }}>#{target.number}</Text>
          <Text sx={{ color: 'var(--fg-muted)', fontSize: 0, overflowWrap: 'anywhere' }}>
            {target.owner}/{target.name}
          </Text>
        </Box>
        {data && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--fg-muted)', fontSize: 0, mt: 2, flexWrap: 'wrap' }}>
            {data.author_login && (
              <a
                href={`https://github.com/${data.author_login}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://github.com/${data.author_login}.png?size=40`}
                  alt={data.author_login}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    border: '1px solid var(--border-muted)',
                    display: 'block',
                  }}
                />
                <Text sx={{ color: 'var(--fg-default)', fontWeight: 500 }}>{data.author_login}</Text>
                {(() => {
                  const assoc =
                    target.kind === 'issue'
                      ? (data as IssueDto).author_association
                      : (data as PullDto).author_association;
                  if (!assoc || assoc === 'NONE') return null;
                  return (
                    <Label variant="secondary" sx={{ ml: 1, fontSize: '10px' }}>
                      {assoc.toLowerCase()}
                    </Label>
                  );
                })()}
              </a>
            )}
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
              <ClockIcon size={12} />
              opened {formatRelativeTime(data.created_at)}
            </Box>
            {target.kind === 'pull' && (data as PullDto).merged_at && (
              <Text sx={{ color: 'var(--success-fg)' }}>· merged {formatRelativeTime((data as PullDto).merged_at)}</Text>
            )}
            {data.closed_at && !(target.kind === 'pull' && (data as PullDto).merged_at) && (
              <Text>· closed {formatRelativeTime(data.closed_at)}</Text>
            )}
            {target.kind === 'issue' && (data as IssueDto).comments > 0 && (
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                <CommentIcon size={12} />
                {(data as IssueDto).comments}
              </Box>
            )}
          </Box>
        )}
        {data && target.kind === 'issue' && (data as IssueDto).labels && (data as IssueDto).labels.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
            <IssueLabels labels={(data as IssueDto).labels} maxVisible={8} maxLabelWidth={180} wrap />
          </Box>
        )}
      </Box>
    </Box>
  );
}

function Body({
  data,
  renderMarkdown,
  kind,
}: {
  data: IssueDto | PullDto;
  renderMarkdown: boolean;
  kind: 'issue' | 'pull';
}) {
  const body = normalizeGitHubBodyMarkdown((data.body ?? '').trim());

  if (!body) {
    return (
      <Box sx={{ color: 'var(--fg-muted)', fontStyle: 'italic', fontSize: 1 }}>
        {kind === 'pull' ? 'No PR description provided.' : 'No description provided.'}
      </Box>
    );
  }

  if (renderMarkdown) {
    return (
      <Box
        className="md-content"
        sx={{
          color: 'var(--fg-default)',
          fontSize: '14px',
          lineHeight: 1.5,
          wordBreak: 'break-word',
        }}
        dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(body) }}
      />
    );
  }

  return (
    <Box
      as="pre"
      sx={{
        m: 0,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: 'mono',
        fontSize: 0,
        color: 'var(--fg-default)',
        lineHeight: 1.6,
      }}
    >
      {body}
    </Box>
  );
}
