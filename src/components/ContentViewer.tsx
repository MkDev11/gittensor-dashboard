'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  XIcon,
  IssueOpenedIcon,
  IssueClosedIcon,
  GitPullRequestIcon,
  GitPullRequestDraftIcon,
  GitPullRequestClosedIcon,
  GitMergeIcon,
  GitCommitIcon,
  SkipIcon,
  ClockIcon,
  CommentIcon,
  LinkExternalIcon,
  PersonIcon,
  PencilIcon,
  TagIcon,
  KebabHorizontalIcon,
  SmileyIcon,
  CheckIcon,
} from '@primer/octicons-react';
import { Box, Text, Label, Link as PrimerLink } from '@primer/react';
import Spinner from '@/components/Spinner';
import { IssueStatusBadge, PullStatusBadge } from '@/components/StatusBadge';
import { IssueLabels } from '@/components/IssueLabels';
import { formatRelativeTime } from '@/lib/format';
import { normalizeGitHubBodyMarkdown, renderMarkdownToHtml } from '@/lib/markdown';
import { useSettings } from '@/lib/settings';
import type { Issue, Pull } from '@/types/entities';

type ContentTarget =
  | { kind: 'issue'; owner: string; name: string; number: number; preloaded?: Issue }
  | { kind: 'pull'; owner: string; name: string; number: number; preloaded?: Pull };

interface ContentViewerProps {
  target: ContentTarget;
  mode: 'modal' | 'inline' | 'side';
  onClose: () => void;
}

function preserveExistingBody<T extends Issue | Pull>(next: T, current: T | null): T {
  const currentBody = current?.body?.trim() ? current.body : null;
  const nextHasBody = !!next.body?.trim();
  const withBody = !nextHasBody && currentBody ? { ...next, body: currentBody } : next;
  if (
    current &&
    'merged_pr_count' in current &&
    typeof current.merged_pr_count === 'number' &&
    (!('merged_pr_count' in withBody) || typeof withBody.merged_pr_count !== 'number')
  ) {
    return { ...withBody, merged_pr_count: current.merged_pr_count } as T;
  }
  return withBody;
}

type ActiveTab = { kind: 'issue' } | { kind: 'pull'; number: number };

const TIMELINE_FETCH_VERSION = '7';

type RelatedIssue = Issue & { source?: string };

type TimelineSubject = {
  number: number | null;
  title: string | null;
  state: string | null;
  state_reason: string | null;
  html_url: string | null;
  repo_full_name: string | null;
  is_pull_request: boolean;
  merged: boolean | null;
  draft: boolean | null;
};

type IssueTimelineEvent = {
  id: string;
  event: string;
  actor_login: string | null;
  actor_avatar_url: string | null;
  actor_html_url: string | null;
  author_association: string | null;
  body: string | null;
  html_url: string | null;
  created_at: string | null;
  label: { name: string; color?: string | null } | null;
  assignee_login: string | null;
  assignee_avatar_url: string | null;
  source: TimelineSubject | null;
  subject: TimelineSubject | null;
  rename: { from: string | null; to: string | null } | null;
  commit_id: string | null;
  commit_message: string | null;
  commit_html_url: string | null;
  commit_verified: boolean | null;
  review_state: string | null;
  state_reason: string | null;
  will_close: boolean | null;
};

export default function ContentViewer({ target, mode, onClose }: ContentViewerProps) {
  const { settings } = useSettings();
  const targetKey = `${target.kind}:${target.owner}/${target.name}#${target.number}`;
  const targetRef = useRef(target);
  targetRef.current = target;
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [issueData, setIssueData] = useState<Issue | null>(
    target.kind === 'issue' ? ((target.preloaded as Issue | undefined) ?? null) : null
  );
  const [pullData, setPullData] = useState<Pull | null>(
    target.kind === 'pull' ? ((target.preloaded as Pull | undefined) ?? null) : null
  );
  const [linkedIssueData, setLinkedIssueData] = useState<RelatedIssue | null>(null);
  const [relatedPRs, setRelatedPRs] = useState<Pull[]>([]);
  const [relatedPRsLoaded, setRelatedPRsLoaded] = useState(false);
  const [timelineEvents, setTimelineEvents] = useState<IssueTimelineEvent[]>([]);
  const [timelineLoaded, setTimelineLoaded] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>(
    target.kind === 'issue' ? { kind: 'issue' } : { kind: 'pull', number: target.number }
  );
  const [loading, setLoading] = useState(!target.preloaded);
  const [error, setError] = useState<string | null>(null);
  const activeTabKey = activeTab.kind === 'issue' ? 'issue' : `pull:${activeTab.number}`;

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  // Reset all state when the underlying target changes
  useEffect(() => {
    const currentTarget = targetRef.current;
    if (currentTarget.kind === 'issue') {
      setIssueData((currentTarget.preloaded as Issue | undefined) ?? null);
      setPullData(null);
      setActiveTab({ kind: 'issue' });
    } else {
      setIssueData(null);
      setPullData((currentTarget.preloaded as Pull | undefined) ?? null);
      setActiveTab({ kind: 'pull', number: currentTarget.number });
    }
    setLinkedIssueData(null);
    setRelatedPRs([]);
    setRelatedPRsLoaded(false);
    setTimelineEvents([]);
    setTimelineLoaded(false);
    setTimelineError(null);
    setError(null);
  }, [targetKey]);

  useEffect(() => {
    bodyScrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [targetKey, activeTabKey]);

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
    fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (fetchedForRef.current !== key) return; // user moved to another target
        if (target.kind === 'issue') {
          setIssueData((current) => preserveExistingBody(j as Issue, current));
        } else {
          setPullData((current) => preserveExistingBody(j as Pull, current));
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
  }, [target.kind, target.name, target.number, target.owner, targetKey]);

  // Fetch related PRs for issue mode (so we can show tabs)
  useEffect(() => {
    if (target.kind !== 'issue') return;
    setRelatedPRsLoaded(false);
    fetch(`/api/related-prs/${target.owner}/${target.name}/${target.number}`)
      .then((r) => r.json())
      .then((j) => setRelatedPRs(Array.isArray(j.pulls) ? (j.pulls as Pull[]) : []))
      .catch(() => setRelatedPRs([]))
      .finally(() => setRelatedPRsLoaded(true));
  }, [target.kind, target.name, target.number, target.owner, targetKey]);

  useEffect(() => {
    if (target.kind !== 'pull') return;
    setLinkedIssueData(null);
    setRelatedPRs([]);
    setRelatedPRsLoaded(false);
    fetch(`/api/related-issues/${target.owner}/${target.name}/${target.number}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        const issues = Array.isArray(j.issues) ? (j.issues as RelatedIssue[]) : [];
        const pulls = Array.isArray(j.related_pulls) ? (j.related_pulls as Pull[]) : [];
        setLinkedIssueData(issues[0] ?? null);
        setRelatedPRs(pulls);
      })
      .catch(() => {
        setLinkedIssueData(null);
        setRelatedPRs([]);
      })
      .finally(() => setRelatedPRsLoaded(true));
  }, [target.kind, target.name, target.number, target.owner, targetKey]);

  const activeIssueNumber =
    activeTab.kind === 'issue'
      ? target.kind === 'issue'
        ? target.number
        : linkedIssueData?.number ?? null
      : null;
  const activeTabPullNumber = activeTab.kind === 'pull' ? activeTab.number : null;
  const activeTimelineTarget = useMemo(() => {
    if (activeTab.kind === 'issue') {
      return activeIssueNumber
        ? { kind: 'issue' as const, owner: target.owner, name: target.name, number: activeIssueNumber }
        : null;
    }
    return activeTabPullNumber === null
      ? null
      : { kind: 'pull' as const, owner: target.owner, name: target.name, number: activeTabPullNumber };
  }, [activeIssueNumber, activeTab.kind, activeTabPullNumber, target.name, target.owner]);
  const activeTimelineKey = activeTimelineTarget
    ? `${activeTimelineTarget.kind}:${activeTimelineTarget.owner}/${activeTimelineTarget.name}#${activeTimelineTarget.number}`
    : 'none';

  useEffect(() => {
    if (!activeTimelineTarget) {
      setTimelineEvents([]);
      setTimelineLoaded(true);
      setTimelineError(null);
      return;
    }
    const ctrl = new AbortController();
    setTimelineEvents([]);
    setTimelineLoaded(false);
    setTimelineError(null);
    fetch(`/api/issue/${activeTimelineTarget.owner}/${activeTimelineTarget.name}/${activeTimelineTarget.number}/timeline?kind=${activeTimelineTarget.kind}&v=${TIMELINE_FETCH_VERSION}`, {
      signal: ctrl.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        setTimelineEvents(Array.isArray(j.events) ? (j.events as IssueTimelineEvent[]) : []);
      })
      .catch((e) => {
        if ((e as Error).name === 'AbortError') return;
        setTimelineEvents([]);
        setTimelineError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setTimelineLoaded(true);
      });
    return () => ctrl.abort();
  }, [activeTimelineKey, activeTimelineTarget]);

  useEffect(() => {
    if (mode !== 'modal') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mode, onClose]);

  // Compute what the header/body should display based on the active tab
  const showTabs =
    (target.kind === 'issue' && relatedPRs.length > 0) ||
    (target.kind === 'pull' && (!!linkedIssueData || relatedPRs.length > 1));
  const activeIssueData = target.kind === 'issue' ? issueData : linkedIssueData;
  const preloadedMergedPRCount =
    activeTab.kind === 'issue' && typeof activeIssueData?.merged_pr_count === 'number'
      ? activeIssueData.merged_pr_count
      : null;
  const mergedPRCount =
    activeTab.kind === 'issue'
      ? relatedPRsLoaded
        ? relatedPRs.filter((pr) => pr.merged === 1).length
        : preloadedMergedPRCount
      : null;
  const activePR =
    activeTab.kind === 'pull'
      ? mergeActivePull(
          relatedPRs.find((p) => p.number === activeTab.number) ?? null,
          activeTab.number === target.number ? pullData : null,
        )
      : null;

  const viewTarget: ContentTarget =
    activeTab.kind === 'issue'
      ? { kind: 'issue', owner: target.owner, name: target.name, number: activeIssueNumber ?? target.number }
      : { kind: 'pull', owner: target.owner, name: target.name, number: activeTab.number };
  const viewData: Issue | Pull | null =
    activeTab.kind === 'issue' ? issueData ?? linkedIssueData : activePR;

  const inner = (
    <Box
      sx={{
        bg: 'var(--bg-canvas)',
        border: mode === 'modal' ? '1px solid' : 'none',
        borderColor: 'var(--border-default)',
        borderRadius: mode === 'modal' ? [0, 2] : 0,
        width: '100%',
        minWidth: 0,
        maxWidth: mode === 'modal' ? ['none', 880] : 'none',
        boxShadow: mode === 'modal' ? 'var(--shadow-overlay)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        height: mode === 'modal' ? ['100dvh', 'auto'] : 'auto',
        maxHeight: mode === 'modal' ? ['100dvh', 'calc(100vh - 80px)'] : 'none',
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
          issueNumber={target.kind === 'issue' ? target.number : linkedIssueData?.number ?? null}
          relatedPRs={relatedPRs}
          activeTab={activeTab}
          onChange={setActiveTab}
        />
      )}
      <Box
        ref={bodyScrollRef as unknown as React.Ref<HTMLDivElement>}
        sx={{
          p: [2, 3],
          overflowY: mode === 'modal' ? 'auto' : 'visible',
          overflowX: 'hidden',
          flex: 1,
          minHeight: 0,
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
          return (
            <TimelineBody
              data={viewData}
              renderMarkdown={settings.renderMarkdown}
              kind={viewTarget.kind}
              relatedPRs={relatedPRs}
              timelineEvents={timelineEvents}
              timelineLoaded={timelineLoaded}
              timelineError={timelineError}
            />
          );
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
    return <SidePanel inner={inner} onClose={onClose} resetKey={`${targetKey}:${activeTabKey}`} />;
  }

  const modal = (
    <Box
      onClick={onClose}
      sx={{
        position: 'fixed',
        inset: 0,
        bg: 'rgba(0, 0, 0, 0.6)',
        zIndex: 10000,
        display: 'flex',
        alignItems: ['stretch', 'flex-start'],
        justifyContent: 'center',
        py: [0, 4],
        overflowY: 'auto',
      }}
    >
      <Box
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        sx={{
          width: '100%',
          minWidth: 0,
          height: ['100dvh', 'auto'],
          mx: [0, 3],
          maxWidth: ['none', 880],
        }}
      >
        {inner}
      </Box>
    </Box>
  );
  return portalRoot ? createPortal(modal, portalRoot) : null;
}

function mergeActivePull(related: Pull | null, detailed: Pull | null): Pull | null {
  if (!related) return detailed;
  if (!detailed) return related;
  if (related.number !== detailed.number || related.repo_full_name !== detailed.repo_full_name) return related;
  return {
    ...related,
    ...detailed,
    body: detailed.body?.trim() ? detailed.body : related.body,
  };
}

function SidePanel({
  inner,
  onClose,
  resetKey,
}: {
  inner: React.ReactNode;
  onClose: () => void;
  resetKey: string;
}) {
  const [isClosing, setIsClosing] = useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [resetKey]);

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
      <Box
        ref={scrollRef as unknown as React.Ref<HTMLDivElement>}
        sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}
      >
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
  issueNumber: number | null;
  relatedPRs: Pull[];
  activeTab: ActiveTab;
  onChange: (next: ActiveTab) => void;
}) {
  const tabs: Array<{
    key: string;
    isActive: boolean;
    onClick: () => void;
    node: React.ReactNode;
    tone: string;
    statusLabel?: string | null;
    statusTone?: string | null;
  }> = [
    ...(issueNumber
      ? [{
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
    }]
      : []),
    ...relatedPRs.map((pr) => {
      const status = pr.merged ? 'merged' : pr.draft ? 'draft' : pr.state === 'open' ? 'open' : 'closed';
      const tone =
        status === 'merged' ? 'var(--done-emphasis)' :
        status === 'open' ? 'var(--success-emphasis)' :
        status === 'draft' ? 'var(--fg-muted)' :
        'var(--danger-emphasis)';
      const Icon =
        status === 'merged' ? GitMergeIcon :
        status === 'draft' ? GitPullRequestDraftIcon :
        status === 'closed' ? GitPullRequestClosedIcon :
        GitPullRequestIcon;
      const statusLabel = status === 'open' ? null : status;
      return {
        key: `pr-${pr.number}`,
        isActive: activeTab.kind === 'pull' && activeTab.number === pr.number,
        onClick: () => onChange({ kind: 'pull', number: pr.number }),
        tone,
        statusLabel,
        statusTone: status === 'open' ? null : tone,
        node: (
          <>
            <Icon size={12} />
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
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: 0,
        minHeight: 42,
        borderBottom: '1px solid',
        borderColor: 'var(--border-default)',
        bg: 'var(--bg-subtle)',
        overflowX: 'auto',
        overflowY: 'hidden',
        flexShrink: 0,
        minWidth: 0,
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': {
          display: 'none',
        },
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
            position: 'relative',
            minHeight: 42,
            px: '10px',
            py: 0,
            border: 0,
            borderBottom: '3px solid',
            borderBottomColor: t.isActive ? t.tone : 'transparent',
            borderRadius: 0,
            bg: 'transparent',
            color: t.isActive ? 'var(--fg-default)' : 'var(--fg-muted)',
            fontFamily: 'inherit',
            fontSize: 0,
            fontWeight: t.isActive ? 600 : 500,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            lineHeight: '18px',
            transition: 'color 80ms, border-color 80ms',
            '&:hover': {
              color: 'var(--fg-default)',
            },
          }}
        >
          {t.node}
          {t.statusLabel && (
            <Box as="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '5px', ml: '2px' }}>
              <Box
                as="span"
                sx={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  bg: t.statusTone ?? 'var(--fg-muted)',
                  flexShrink: 0,
                }}
              />
              <Text
                as="span"
                sx={{
                  color: 'var(--fg-subtle)',
                  fontSize: '10px',
                  fontWeight: 600,
                  lineHeight: '14px',
                  textTransform: 'lowercase',
                }}
              >
                {t.statusLabel}
              </Text>
            </Box>
          )}
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
  data: Issue | Pull | null;
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
        <IssueStatusBadge issue={data as Issue} mergedPRCount={mergedPRCount} />
      ) : (
        <IssueOpenedIcon size={16} />
      )
    ) : data ? (
      <PullStatusBadge pr={data as Pull} />
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
                      ? (data as Issue).author_association
                      : (data as Pull).author_association;
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
            {target.kind === 'pull' && (data as Pull).merged_at && (
              <Text sx={{ color: 'var(--success-fg)' }}>· merged {formatRelativeTime((data as Pull).merged_at)}</Text>
            )}
            {data.closed_at && !(target.kind === 'pull' && (data as Pull).merged_at) && (
              <Text>· closed {formatRelativeTime(data.closed_at)}</Text>
            )}
            {target.kind === 'issue' && (data as Issue).comments > 0 && (
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                <CommentIcon size={12} />
                {(data as Issue).comments}
              </Box>
            )}
          </Box>
        )}
        {data && target.kind === 'issue' && (data as Issue).labels && (data as Issue).labels.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
            <IssueLabels labels={(data as Issue).labels} maxVisible={8} maxLabelWidth={180} wrap />
          </Box>
        )}
      </Box>
    </Box>
  );
}

function TimelineBody({
  data,
  renderMarkdown,
  kind,
  relatedPRs,
  timelineEvents,
  timelineLoaded,
  timelineError,
}: {
  data: Issue | Pull;
  renderMarkdown: boolean;
  kind: 'issue' | 'pull';
  relatedPRs: Pull[];
  timelineEvents: IssueTimelineEvent[];
  timelineLoaded: boolean;
  timelineError: string | null;
}) {
  const body = normalizeGitHubBodyMarkdown((data.body ?? '').trim());
  const author = data.author_login ?? 'unknown';
  const mergedRelatedPR = kind === 'issue' ? relatedPRs.find((pr) => pr.merged === 1) ?? null : null;
  const closedAt = kind === 'pull' && (data as Pull).merged_at ? (data as Pull).merged_at : data.closed_at;
  const closedActor = mergedRelatedPR?.author_login ?? data.author_login;

  return (
    <Box sx={{ position: 'relative', maxWidth: '100%', pb: 4 }}>
      <Box
        aria-hidden="true"
        sx={{
          position: 'absolute',
          left: ['16px', '20px'],
          top: 44,
          bottom: 32,
          width: 0,
          borderLeft: '1px solid',
          borderColor: 'var(--border-default)',
          transform: 'translateX(-0.5px)',
        }}
      />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: ['32px minmax(0, 1fr)', '40px minmax(0, 1fr)'],
          columnGap: 2,
          alignItems: 'start',
          position: 'relative',
        }}
      >
        <TimelineAvatar login={data.author_login} />
        <Box
          sx={{
            minWidth: 0,
            border: '1px solid',
            borderColor: 'var(--border-default)',
            borderRadius: 2,
            bg: 'var(--bg-canvas)',
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              px: [2, 3],
              py: 2,
              borderBottom: '1px solid',
              borderColor: 'var(--border-default)',
              bg: 'var(--bg-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>
              <Text as="span" sx={{ color: 'var(--fg-default)', fontWeight: 600 }}>
                {author}
              </Text>{' '}
              opened this {kind === 'pull' ? 'pull request' : 'issue'} {formatRelativeTime(data.created_at)}
            </Text>
            <Text sx={{ color: 'var(--fg-muted)', fontSize: 0, fontVariantNumeric: 'tabular-nums' }}>
              #{data.number}
            </Text>
          </Box>

          <Box sx={{ p: [2, 3] }}>
            <BodyContent body={body} renderMarkdown={renderMarkdown} kind={kind} repoFullName={data.repo_full_name} />
          </Box>
        </Box>
      </Box>

      {(kind === 'issue' || timelineEvents.length > 0 || !timelineLoaded || timelineError) && (
        <DetailTimeline
          data={data}
          kind={kind}
          events={timelineEvents}
          loading={!timelineLoaded}
          error={timelineError}
          renderMarkdown={renderMarkdown}
          relatedPRs={relatedPRs}
        />
      )}

      {kind === 'pull' && closedAt && timelineLoaded && !timelineHasPullCloseEvent(timelineEvents) && (
        <TimelineEvent
          icon={(data as Pull).merged_at ? <GitMergeIcon size={14} /> : <GitPullRequestClosedIcon size={14} />}
          tone={(data as Pull).merged_at ? 'success' : 'muted'}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
              <TimelineActor login={closedActor} fallback={author} />
              <ClosedTimelineText
                data={data}
                kind={kind}
                closedAt={closedAt}
                mergedRelatedPR={mergedRelatedPR}
              />
            </Box>
            <PullStatusBadge pr={data as Pull} />
          </Box>
        </TimelineEvent>
      )}
    </Box>
  );
}

function timelineHasPullCloseEvent(events: IssueTimelineEvent[]): boolean {
  return events.some((event) => event.event === 'closed' || event.event === 'merged');
}

function ClosedTimelineText({
  data,
  kind,
  closedAt,
  mergedRelatedPR,
}: {
  data: Issue | Pull;
  kind: 'issue' | 'pull';
  closedAt: string;
  mergedRelatedPR: Pull | null;
}) {
  if (kind === 'pull') {
    const pr = data as Pull;
    return (
      <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>
        {pr.merged_at ? 'merged this pull request' : 'closed this pull request'} {formatRelativeTime(closedAt)}
      </Text>
    );
  }

  const issue = data as Issue;
  if (mergedRelatedPR) {
    return (
      <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>
        closed this as{' '}
        <Text as="span" sx={{ color: 'var(--fg-default)', fontWeight: 600 }}>
          completed
        </Text>{' '}
        in{' '}
        <PrimerLink
          href={mergedRelatedPR.html_url ?? `https://github.com/${issue.repo_full_name}/pull/${mergedRelatedPR.number}`}
          target="_blank"
          rel="noreferrer"
          sx={{ color: 'var(--accent-fg)', fontWeight: 600 }}
        >
          #{mergedRelatedPR.number}
        </PrimerLink>{' '}
        {formatRelativeTime(closedAt)}
      </Text>
    );
  }

  const reason = issue.state_reason ? formatIssueCloseReason(issue.state_reason) : null;
  return (
    <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>
      {reason ? (
        <>
          closed this as{' '}
          <Text as="span" sx={{ color: 'var(--fg-default)', fontWeight: 600 }}>
            {reason}
          </Text>
        </>
      ) : (
        'closed this issue'
      )}{' '}
      {formatRelativeTime(closedAt)}
    </Text>
  );
}

function DetailTimeline({
  data,
  kind,
  events,
  loading,
  error,
  renderMarkdown,
  relatedPRs,
}: {
  data: Issue | Pull;
  kind: 'issue' | 'pull';
  events: IssueTimelineEvent[];
  loading: boolean;
  error: string | null;
  renderMarkdown: boolean;
  relatedPRs: Pull[];
}) {
  if (loading) {
    return (
      <TimelineEvent icon={<ClockIcon size={14} />}>
        <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>Loading timeline…</Text>
      </TimelineEvent>
    );
  }

  if (error) {
    return (
      <TimelineEvent icon={<ClockIcon size={14} />}>
        <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>
          Timeline unavailable from GitHub right now.
        </Text>
      </TimelineEvent>
    );
  }

  const hasMergedEvent = kind === 'pull' && events.some((event) => event.event === 'merged');
  const visibleEvents = events.filter((event) => {
    if (kind === 'pull' && hasMergedEvent && event.event === 'closed') return false;
    if (kind === 'pull' && event.event === 'committed' && !event.commit_id && !event.commit_message) return false;
    return true;
  });

  return (
    <>
      {visibleEvents.map((event) => (
        <IssueTimelineItem
          key={`${event.event}-${event.id}`}
          event={event}
          data={data}
          kind={kind}
          renderMarkdown={renderMarkdown}
          relatedPRs={relatedPRs}
        />
      ))}
    </>
  );
}

function IssueTimelineItem({
  event,
  data,
  kind,
  renderMarkdown,
  relatedPRs,
}: {
  event: IssueTimelineEvent;
  data: Issue | Pull;
  kind: 'issue' | 'pull';
  renderMarkdown: boolean;
  relatedPRs: Pull[];
}) {
  if (event.event === 'reviewed') {
    if (event.body !== null) {
      return <PullReviewComment event={event} renderMarkdown={renderMarkdown} repoFullName={data.repo_full_name} />;
    }
    return <PullReviewTimelineEvent event={event} />;
  }
  if (event.event === 'commented' && event.body !== null) {
    return <TimelineComment event={event} renderMarkdown={renderMarkdown} kind={kind} repoFullName={data.repo_full_name} />;
  }
  if (event.event === 'labeled' || event.event === 'unlabeled') {
    return <LabelTimelineEvent event={event} />;
  }
  if (event.event === 'closed' && kind === 'issue') {
    return <ClosedIssueTimelineEvent event={event} issue={data as Issue} relatedPRs={relatedPRs} />;
  }
  if ((event.event === 'closed' || event.event === 'merged') && kind === 'pull') {
    return <ClosedPullTimelineEvent event={event} pr={data as Pull} />;
  }
  if (event.event === 'reopened') {
    return (
      <TimelineEvent icon={kind === 'pull' ? <GitPullRequestIcon size={14} /> : <IssueOpenedIcon size={14} />} tone="success">
        <TimelineSentence event={event} verb="reopened this" />
      </TimelineEvent>
    );
  }
  if (event.event === 'cross-referenced' || event.event === 'connected') {
    return <ReferenceTimelineEvent event={event} data={data} kind={kind} relatedPRs={relatedPRs} />;
  }
  if (event.event === 'referenced' || event.event === 'committed') {
    return <CommitReferenceTimelineEvent event={event} kind={kind} />;
  }
  if (event.event === 'assigned' || event.event === 'unassigned') {
    return <AssignmentTimelineEvent event={event} />;
  }
  if (event.event === 'renamed') {
    return <RenamedTimelineEvent event={event} />;
  }

  return <GenericTimelineEvent event={event} />;
}

function TimelineComment({
  event,
  renderMarkdown,
  kind,
  repoFullName,
}: {
  event: IssueTimelineEvent;
  renderMarkdown: boolean;
  kind: 'issue' | 'pull';
  repoFullName: string;
}) {
  const author = event.actor_login ?? 'unknown';
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: ['32px minmax(0, 1fr)', '40px minmax(0, 1fr)'],
        columnGap: 2,
        alignItems: 'start',
        mt: 3,
        position: 'relative',
      }}
    >
      <TimelineAvatar login={event.actor_login} avatarUrl={event.actor_avatar_url} />
      <Box
        sx={{
          minWidth: 0,
          border: '1px solid',
          borderColor: 'var(--border-default)',
          borderRadius: 2,
          bg: 'var(--bg-canvas)',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            px: [2, 3],
            py: 2,
            borderBottom: '1px solid',
            borderColor: 'var(--border-default)',
            bg: 'var(--bg-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
            <Text sx={{ color: 'var(--fg-default)', fontWeight: 600, fontSize: 0 }}>{author}</Text>
            {isBotLogin(author) && <SmallTimelinePill>bot</SmallTimelinePill>}
            <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>{formatRelativeTime(event.created_at)}</Text>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            <AssociationPill association={event.author_association} />
            <Box sx={{ color: 'var(--fg-muted)', display: 'inline-flex' }}>
              <KebabHorizontalIcon size={16} />
            </Box>
          </Box>
        </Box>
        <Box sx={{ p: [2, 3] }}>
          <BodyContent
            body={normalizeGitHubBodyMarkdown((event.body ?? '').trim())}
            renderMarkdown={renderMarkdown}
            kind={kind}
            repoFullName={repoFullName}
          />
        </Box>
        <Box sx={{ px: [2, 3], pb: 2 }}>
          <Box
            sx={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: '1px solid',
              borderColor: 'var(--border-muted)',
              color: 'var(--fg-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SmileyIcon size={14} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function PullReviewComment({
  event,
  renderMarkdown,
  repoFullName,
}: {
  event: IssueTimelineEvent;
  renderMarkdown: boolean;
  repoFullName: string;
}) {
  return (
    <TimelineComment
      event={event}
      renderMarkdown={renderMarkdown}
      kind="pull"
      repoFullName={repoFullName}
    />
  );
}

function PullReviewTimelineEvent({ event }: { event: IssueTimelineEvent }) {
  const state = (event.review_state ?? '').toLowerCase();
  const isApproved = state === 'approved';
  const isChangesRequested = state === 'changes_requested';
  const verb = isApproved
    ? 'approved these changes'
    : isChangesRequested
    ? 'requested changes'
    : 'reviewed';
  return (
    <TimelineEvent icon={isApproved ? <CheckIcon size={14} /> : <ClockIcon size={14} />} tone={isApproved ? 'success' : 'muted'}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
        <TimelineActor login={event.actor_login} avatarUrl={event.actor_avatar_url} />
        <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>{verb}</Text>
        <TimelineWhen iso={event.created_at} />
      </Box>
    </TimelineEvent>
  );
}

function ClosedPullTimelineEvent({ event, pr }: { event: IssueTimelineEvent; pr: Pull }) {
  const merged = event.event === 'merged' || pr.merged === 1 || !!pr.merged_at;
  return (
    <TimelineEvent
      icon={merged ? <GitMergeIcon size={14} /> : <GitPullRequestClosedIcon size={14} />}
      tone={merged ? 'success' : 'muted'}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
          <TimelineActor login={event.actor_login} avatarUrl={event.actor_avatar_url} fallback={pr.author_login ?? 'unknown'} />
          <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>
            {merged ? 'merged this pull request' : 'closed this pull request'}
          </Text>
          <TimelineWhen iso={event.created_at ?? pr.merged_at ?? pr.closed_at} />
        </Box>
        <PullStatusBadge pr={pr} />
      </Box>
    </TimelineEvent>
  );
}

function LabelTimelineEvent({ event }: { event: IssueTimelineEvent }) {
  return (
    <TimelineEvent icon={<TagIcon size={14} />}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
        <TimelineActor login={event.actor_login} avatarUrl={event.actor_avatar_url} />
        <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>
          {event.event === 'labeled' ? 'added' : 'removed'}{' '}
        </Text>
        {event.label ? <IssueLabels labels={[event.label]} maxVisible={1} maxLabelWidth={180} /> : <Text sx={{ color: 'var(--fg-default)', fontWeight: 600 }}>a label</Text>}
        <TimelineWhen iso={event.created_at} />
      </Box>
    </TimelineEvent>
  );
}

function ClosedIssueTimelineEvent({
  event,
  issue,
  relatedPRs,
}: {
  event: IssueTimelineEvent;
  issue: Issue;
  relatedPRs: Pull[];
}) {
  const reason = event.state_reason ?? issue.state_reason;
  const normalizedReason = reason?.toUpperCase() ?? null;
  const completedPR =
    normalizedReason === 'COMPLETED'
      ? relatedPRs.find((pr) => pr.merged === 1) ?? relatedPRs.find((pr) => pr.number === event.source?.number || pr.number === event.subject?.number) ?? null
      : null;
  return (
    <TimelineEvent icon={<IssueClosedIcon size={14} />} tone={normalizedReason === 'COMPLETED' ? 'done' : 'muted'}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
          <TimelineActor login={event.actor_login} avatarUrl={event.actor_avatar_url} />
          <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>
            closed this{reason ? ' as ' : ' '}
            {reason && (
              <Text as="span" sx={{ color: 'var(--fg-default)', fontWeight: 600 }}>
                {formatIssueCloseReason(reason)}
              </Text>
            )}
            {completedPR && (
              <>
                {' '}in{' '}
                <PrimerLink
                  href={completedPR.html_url ?? `https://github.com/${issue.repo_full_name}/pull/${completedPR.number}`}
                  target="_blank"
                  rel="noreferrer"
                  sx={{ color: 'var(--accent-fg)', fontWeight: 600 }}
                >
                  #{completedPR.number}
                </PrimerLink>
              </>
            )}
          </Text>
          <TimelineWhen iso={event.created_at} />
        </Box>
        <IssueStatusBadge issue={issue} mergedPRCount={completedPR ? 1 : (issue.merged_pr_count ?? 0)} />
      </Box>
    </TimelineEvent>
  );
}

function ReferenceTimelineEvent({
  event,
  data,
  kind,
  relatedPRs,
}: {
  event: IssueTimelineEvent;
  data: Issue | Pull;
  kind: 'issue' | 'pull';
  relatedPRs: Pull[];
}) {
  const subject = event.source ?? event.subject;
  const matchedPr =
    subject?.is_pull_request && subject.number
      ? relatedPRs.find((pr) => pr.number === subject.number) ?? pullFromSubject(subject, data.repo_full_name)
      : null;
  const eventText =
    kind === 'issue' && matchedPr && event.will_close === true
      ? 'linked a pull request that will close this issue'
      : kind === 'issue' && event.event === 'connected'
      ? 'linked a pull request'
      : 'mentioned this';
  return (
    <TimelineEvent icon={<LinkExternalIcon size={14} />}>
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
          <TimelineActor login={event.actor_login} avatarUrl={event.actor_avatar_url} />
          <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>
            {eventText}
          </Text>
          <TimelineWhen iso={event.created_at} />
        </Box>
        {matchedPr ? (
          <TimelineReferenceBox>
            {subject && <ReferenceSubjectIcon subject={subject} pr={matchedPr} />}
            <TimelinePullLink pr={matchedPr} repoFullName={data.repo_full_name} />
          </TimelineReferenceBox>
        ) : subject ? (
          <TimelineSubjectLink subject={subject} fallbackRepo={data.repo_full_name} />
        ) : null}
      </Box>
    </TimelineEvent>
  );
}

function CommitReferenceTimelineEvent({ event, kind }: { event: IssueTimelineEvent; kind: 'issue' | 'pull' }) {
  const shortSha = event.commit_id ? event.commit_id.slice(0, 7) : null;
  const verb =
    event.event === 'committed'
      ? 'added a commit to this pull request'
      : `added a commit that references this ${kind === 'pull' ? 'pull request' : 'issue'}`;
  return (
    <TimelineEvent icon={<GitCommitIcon size={14} />}>
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
          <TimelineActor login={event.actor_login} avatarUrl={event.actor_avatar_url} />
          <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>{verb}</Text>
          <TimelineWhen iso={event.created_at} />
        </Box>
        <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flexWrap: 'wrap' }}>
          {event.commit_message && (
            <PrimerLink
              href={event.commit_html_url ?? undefined}
              target="_blank"
              rel="noreferrer"
              sx={{
                color: 'var(--fg-default)',
                fontFamily: 'mono',
                fontSize: 0,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                '&:hover': { color: 'var(--accent-fg)' },
              }}
            >
              {event.commit_message}
            </PrimerLink>
          )}
          {event.commit_verified && <VerifiedPill />}
          {shortSha && (
            <PrimerLink
              href={event.commit_html_url ?? undefined}
              target="_blank"
              rel="noreferrer"
              sx={{ color: 'var(--fg-muted)', fontFamily: 'mono', fontSize: 0, flexShrink: 0 }}
            >
              {shortSha}
            </PrimerLink>
          )}
        </Box>
      </Box>
    </TimelineEvent>
  );
}

function AssignmentTimelineEvent({ event }: { event: IssueTimelineEvent }) {
  return (
    <TimelineEvent icon={<PersonIcon size={14} />}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
        <TimelineActor login={event.actor_login} avatarUrl={event.actor_avatar_url} />
        <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>
          {event.event === 'assigned' ? 'assigned' : 'unassigned'}
        </Text>
        <TimelineActor login={event.assignee_login} avatarUrl={event.assignee_avatar_url} />
        <TimelineWhen iso={event.created_at} />
      </Box>
    </TimelineEvent>
  );
}

function RenamedTimelineEvent({ event }: { event: IssueTimelineEvent }) {
  return (
    <TimelineEvent icon={<PencilIcon size={14} />}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
        <TimelineActor login={event.actor_login} avatarUrl={event.actor_avatar_url} />
        <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>changed the title</Text>
        {event.rename && (
          <Text
            as="span"
            sx={{
              color: 'var(--fg-default)',
              fontSize: 0,
              minWidth: 0,
              overflowWrap: 'anywhere',
            }}
          >
            {event.rename.from && (
              <>
                <Text as="span" sx={{ color: 'var(--fg-muted)', textDecoration: 'line-through' }}>
                  {event.rename.from}
                </Text>{' '}
              </>
            )}
            {event.rename.to}
          </Text>
        )}
        <TimelineWhen iso={event.created_at} />
      </Box>
    </TimelineEvent>
  );
}

function GenericTimelineEvent({ event }: { event: IssueTimelineEvent }) {
  return (
    <TimelineEvent icon={<ClockIcon size={14} />}>
      <TimelineSentence event={event} verb={formatTimelineEventVerb(event.event)} />
    </TimelineEvent>
  );
}

function TimelineSentence({ event, verb }: { event: IssueTimelineEvent; verb: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
      <TimelineActor login={event.actor_login} avatarUrl={event.actor_avatar_url} />
      <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>{verb}</Text>
      <TimelineWhen iso={event.created_at} />
    </Box>
  );
}

function BodyContent({
  body,
  renderMarkdown,
  kind,
  repoFullName,
}: {
  body: string;
  renderMarkdown: boolean;
  kind: 'issue' | 'pull';
  repoFullName?: string | null;
}) {
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
        dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(body, { repoFullName }) }}
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

function TimelineEvent({
  icon,
  children,
  tone = 'muted',
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  tone?: 'muted' | 'done' | 'success';
}) {
  const toneSx =
    tone === 'done'
      ? { bg: 'var(--done-emphasis)', borderColor: 'var(--done-emphasis)', color: '#fff' }
      : tone === 'success'
      ? { bg: 'var(--success-emphasis)', borderColor: 'var(--success-emphasis)', color: '#fff' }
      : { bg: 'var(--bg-emphasis)', borderColor: 'var(--border-default)', color: 'var(--fg-muted)' };

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: ['32px minmax(0, 1fr)', '40px minmax(0, 1fr)'],
        columnGap: 2,
        alignItems: 'start',
        mt: 3,
        position: 'relative',
      }}
    >
      <Box
        sx={{
          justifySelf: 'center',
          width: 28,
          height: 28,
          borderRadius: '50%',
          border: '1px solid',
          ...toneSx,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1,
          boxShadow: '0 0 0 4px var(--bg-canvas)',
        }}
      >
        {icon}
      </Box>
      <Box
        sx={{
          minWidth: 0,
          py: '3px',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

function TimelineActor({
  login,
  avatarUrl,
  fallback = 'unknown',
}: {
  login: string | null | undefined;
  avatarUrl?: string | null;
  fallback?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const label = login ?? fallback;
  const imageUrl = login ? avatarUrl ?? `https://github.com/${encodeURIComponent(login)}.png?size=40` : null;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      {imageUrl && !imageFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          onError={() => setImageFailed(true)}
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            border: '1px solid var(--border-muted)',
            display: 'block',
            flexShrink: 0,
          }}
        />
      ) : (
        <Box
          sx={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            border: '1px solid',
            borderColor: 'var(--border-muted)',
            bg: 'var(--bg-emphasis)',
            color: 'var(--fg-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <PersonIcon size={12} />
        </Box>
      )}
      <Text sx={{ color: 'var(--fg-default)', fontWeight: 600, fontSize: 0 }}>
        {label}
      </Text>
    </Box>
  );
}

function TimelineWhen({ iso }: { iso: string | null | undefined }) {
  return (
    <Text sx={{ color: 'var(--fg-muted)', fontSize: 0 }}>
      {formatRelativeTime(iso)}
    </Text>
  );
}

function SmallTimelinePill({ children }: { children: React.ReactNode }) {
  return (
    <Text
      as="span"
      sx={{
        px: '6px',
        py: '1px',
        border: '1px solid',
        borderColor: 'var(--border-muted)',
        borderRadius: '999px',
        color: 'var(--fg-muted)',
        fontSize: '11px',
        lineHeight: '16px',
      }}
    >
      {children}
    </Text>
  );
}

function AssociationPill({ association }: { association: string | null }) {
  if (!association || association === 'NONE') return null;
  return <SmallTimelinePill>{association.toLowerCase()}</SmallTimelinePill>;
}

function VerifiedPill() {
  return (
    <Text
      as="span"
      sx={{
        px: '7px',
        py: '1px',
        border: '1px solid',
        borderColor: 'var(--success-emphasis)',
        borderRadius: '999px',
        color: 'var(--success-fg)',
        fontSize: '11px',
        fontWeight: 600,
        lineHeight: '16px',
        flexShrink: 0,
      }}
    >
      Verified
    </Text>
  );
}

function isBotLogin(login: string): boolean {
  return login.endsWith('[bot]') || login.toLowerCase().includes('-bot');
}

function TimelinePullLink({ pr, repoFullName }: { pr: Pull; repoFullName: string }) {
  return (
    <PrimerLink
      href={pr.html_url ?? `https://github.com/${repoFullName}/pull/${pr.number}`}
      target="_blank"
      rel="noreferrer"
      sx={{
        color: 'var(--fg-default)',
        fontSize: 0,
        fontWeight: 600,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        textDecoration: 'underline',
        textUnderlineOffset: '2px',
        '&:hover': { color: 'var(--accent-fg)' },
      }}
    >
      {pr.title}{' '}
      <Text as="span" sx={{ color: 'var(--fg-muted)', fontWeight: 500 }}>
        #{pr.number}
      </Text>
    </PrimerLink>
  );
}

function TimelineReferenceBox({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        mt: 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        minWidth: 0,
        maxWidth: '100%',
      }}
    >
      {children}
    </Box>
  );
}

function TimelineSubjectLink({ subject, fallbackRepo }: { subject: TimelineSubject; fallbackRepo: string }) {
  const number = subject.number;
  const title = subject.title ?? (number ? `#${number}` : 'Referenced item');
  const repo = subject.repo_full_name ?? fallbackRepo;
  return (
    <TimelineReferenceBox>
      <ReferenceSubjectIcon subject={subject} />
      <PrimerLink
        href={subject.html_url ?? `https://github.com/${repo}/${subject.is_pull_request ? 'pull' : 'issues'}/${number ?? ''}`}
        target="_blank"
        rel="noreferrer"
        sx={{
          color: 'var(--fg-default)',
          fontSize: 0,
          fontWeight: 600,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textDecoration: 'underline',
          textUnderlineOffset: '2px',
          '&:hover': { color: 'var(--accent-fg)' },
        }}
      >
        {title}{' '}
        {number && (
          <Text as="span" sx={{ color: 'var(--fg-muted)', fontWeight: 500 }}>
            #{number}
          </Text>
        )}
      </PrimerLink>
    </TimelineReferenceBox>
  );
}

function ReferenceSubjectIcon({ subject, pr = null }: { subject: TimelineSubject; pr?: Pull | null }) {
  const normalizedState = (subject.state ?? '').toLowerCase();
  const normalizedReason = (subject.state_reason ?? '').toLowerCase();
  const isDraft = subject.is_pull_request && (pr?.draft === 1 || subject.draft === true);
  const state = subject.is_pull_request
    ? pr?.merged === 1 || subject.merged
      ? 'merged'
      : isDraft
      ? 'draft'
      : pr?.state === 'open' || normalizedState === 'open'
      ? 'open'
      : 'closed'
    : normalizedState === 'closed' && normalizedReason === 'completed'
    ? 'completed'
    : normalizedState === 'closed' && (normalizedReason === 'not_planned' || normalizedReason === 'duplicate')
    ? 'not_planned'
    : normalizedState === 'open'
    ? 'open'
    : 'closed';
  const Icon = subject.is_pull_request
    ? state === 'merged'
      ? GitMergeIcon
      : state === 'draft'
      ? GitPullRequestDraftIcon
      : state === 'closed'
      ? GitPullRequestClosedIcon
      : GitPullRequestIcon
    : state === 'not_planned'
    ? SkipIcon
    : state === 'closed'
    ? IssueClosedIcon
    : IssueOpenedIcon;
  const label = subject.is_pull_request
    ? state === 'merged'
      ? 'Merged pull request'
      : state === 'draft'
      ? 'Draft pull request'
      : state === 'closed'
      ? 'Closed pull request'
      : 'Open pull request'
    : state === 'completed'
    ? 'Completed issue'
    : state === 'not_planned'
    ? 'Not planned issue'
    : state === 'closed'
    ? 'Closed issue'
    : 'Open issue';
  const color =
    state === 'merged'
      ? 'var(--done-emphasis)'
      : state === 'completed'
      ? 'var(--done-emphasis)'
      : state === 'draft'
      ? 'var(--fg-muted)'
      : state === 'not_planned'
      ? 'var(--fg-muted)'
      : state === 'closed'
      ? 'var(--danger-emphasis)'
      : 'var(--success-emphasis)';
  return (
    <Box
      as="span"
      aria-label={label}
      title={label}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        flexShrink: 0,
        color,
      }}
    >
      <Icon size={16} />
    </Box>
  );
}

function pullFromSubject(subject: TimelineSubject, fallbackRepo: string): Pull {
  return {
    id: 0,
    repo_full_name: subject.repo_full_name ?? fallbackRepo,
    number: subject.number ?? 0,
    title: subject.title ?? `Pull request #${subject.number ?? ''}`,
    body: null,
    state: subject.state ?? 'open',
    draft: subject.draft ? 1 : 0,
    merged: subject.merged ? 1 : 0,
    author_login: null,
    author_association: null,
    created_at: null,
    updated_at: null,
    closed_at: subject.state === 'closed' || subject.state === 'merged' ? new Date().toISOString() : null,
    merged_at: subject.merged ? new Date().toISOString() : null,
    html_url: subject.html_url,
    fetched_at: '',
    first_seen_at: '',
  };
}

function formatIssueCloseReason(reason: string): string {
  const normalized = reason.toUpperCase();
  if (normalized === 'COMPLETED') return 'completed';
  if (normalized === 'NOT_PLANNED') return 'not planned';
  if (normalized === 'DUPLICATE') return 'duplicate';
  return 'closed';
}

function formatTimelineEventVerb(event: string): string {
  return event.replace(/-/g, ' ');
}

function TimelineAvatar({ login, avatarUrl }: { login: string | null; avatarUrl?: string | null }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (!login || imageFailed) {
    return (
      <Box
        sx={{
          width: [32, 40],
          height: [32, 40],
          borderRadius: '50%',
          border: '1px solid',
          borderColor: 'var(--border-default)',
          bg: 'var(--bg-emphasis)',
          color: 'var(--fg-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1,
          justifySelf: 'center',
          boxShadow: '0 0 0 4px var(--bg-canvas)',
        }}
      >
        <PersonIcon size={16} />
      </Box>
    );
  }

  const imageUrl = avatarUrl ?? `https://github.com/${encodeURIComponent(login)}.png?size=80`;
  return (
    <Box sx={{ zIndex: 1, justifySelf: 'center', boxShadow: '0 0 0 4px var(--bg-canvas)', borderRadius: '50%' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={login}
        loading="lazy"
        onError={() => setImageFailed(true)}
        style={{
          width: '100%',
          maxWidth: 40,
          minWidth: 32,
          aspectRatio: '1 / 1',
          borderRadius: '50%',
          border: '1px solid var(--border-muted)',
          display: 'block',
          background: 'var(--bg-emphasis)',
        }}
      />
    </Box>
  );
}
