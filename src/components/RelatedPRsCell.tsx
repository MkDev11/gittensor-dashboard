'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from '@primer/react';
import { GitPullRequestIcon } from '@primer/octicons-react';

export type LinkedPullReference = {
  number: number;
  title: string;
  state: string;
  draft: number;
  merged: number;
  author_login?: string | null;
};

type RelatedPopoverLayout = { placement: 'down' | 'up'; maxHeight: number };

const DEFAULT_RELATED_POPOVER_LAYOUT: RelatedPopoverLayout = { placement: 'down', maxHeight: 420 };

function relatedPopoverLayout(anchor: HTMLElement | null, rowCount: number): RelatedPopoverLayout {
  if (!anchor || typeof window === 'undefined') return DEFAULT_RELATED_POPOVER_LAYOUT;
  const rect = anchor.getBoundingClientRect();
  const estimatedHeight = Math.min(480, 36 + rowCount * 32);
  const spaceBelow = window.innerHeight - rect.bottom - 44;
  const spaceAbove = rect.top - 8;
  const placement = spaceBelow >= estimatedHeight || spaceBelow >= spaceAbove ? 'down' : 'up';
  const available = Math.max(120, placement === 'down' ? spaceBelow : spaceAbove);
  return { placement, maxHeight: Math.min(480, available) };
}

function relatedPopoverOffset(layout: RelatedPopoverLayout) {
  return layout.placement === 'up'
    ? { bottom: '100%', mb: 1 }
    : { top: '100%', mt: 1 };
}

export default function RelatedPRsCell({
  prs,
  onPRClick,
}: {
  prs: LinkedPullReference[];
  onPRClick?: (prNumber: number) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [popoverLayout, setPopoverLayout] = useState<RelatedPopoverLayout>(DEFAULT_RELATED_POPOVER_LAYOUT);

  const updatePopoverLayout = () => {
    setPopoverLayout(relatedPopoverLayout(wrapRef.current, prs.length));
  };

  useEffect(() => {
    if (!open) return;
    updatePopoverLayout();
    const onMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('resize', updatePopoverLayout);
    window.addEventListener('scroll', updatePopoverLayout, true);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', updatePopoverLayout);
      window.removeEventListener('scroll', updatePopoverLayout, true);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, prs.length]);

  if (prs.length === 0) {
    return <Text sx={{ color: 'var(--fg-muted)', fontFamily: 'mono', fontSize: 0 }}>—</Text>;
  }

  const merged = prs.filter((p) => p.merged).length;
  const openCount = prs.filter((p) => !p.merged && p.state === 'open').length;
  const tone = openCount > 0 ? 'var(--success-emphasis)' : merged > 0 ? 'var(--done-emphasis)' : 'var(--fg-muted)';

  return (
    <Box
      ref={wrapRef as unknown as React.Ref<HTMLDivElement>}
      sx={{ position: 'relative', display: 'inline-block' }}
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        if (!open) updatePopoverLayout();
        setOpen((v) => !v);
      }}
    >
      <Box
        as="button"
        title={`${prs.length} PR${prs.length === 1 ? '' : 's'} reference this issue`}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          px: '8px',
          py: '3px',
          border: '1px solid',
          borderColor: 'var(--border-default)',
          borderRadius: '999px',
          bg: 'var(--bg-canvas)',
          color: tone,
          fontSize: '12px',
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'inherit',
          '&:hover': { borderColor: tone },
        }}
      >
        <GitPullRequestIcon size={11} />
        {prs.length}
      </Box>
      {open && (
        <Box
          sx={{
            position: 'absolute',
            ...relatedPopoverOffset(popoverLayout),
            right: 0,
            minWidth: 280,
            maxWidth: 360,
            maxHeight: popoverLayout.maxHeight,
            overflowY: 'auto',
            bg: 'var(--bg-subtle)',
            border: '1px solid',
            borderColor: 'var(--border-default)',
            borderRadius: 2,
            boxShadow: 'var(--shadow-overlay)',
            zIndex: 50,
            py: 1,
            textAlign: 'left',
          }}
        >
          <Text sx={{ px: 2, py: 1, fontSize: 0, color: 'var(--fg-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block' }}>
            Linked pull requests
          </Text>
          {prs.map((pr) => {
            const status = pr.merged ? 'merged' : pr.draft ? 'draft' : pr.state === 'open' ? 'open' : 'closed';
            const statusColor =
              status === 'merged' ? 'var(--done-emphasis)' :
              status === 'open' ? 'var(--success-emphasis)' :
              status === 'draft' ? 'var(--fg-muted)' :
              'var(--danger-fg)';
            return (
              <button
                key={pr.number}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  setOpen(false);
                  void onPRClick?.(pr.number);
                }}
                onMouseEnter={highlightRelatedRow}
                onMouseLeave={unhighlightRelatedRow}
                style={relatedPopoverRowStyle}
              >
                {pr.author_login ? (
                  <span style={relatedPopoverAuthorStyle}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://github.com/${pr.author_login}.png?size=32`}
                      alt={pr.author_login}
                      loading="lazy"
                      style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--border-muted)', display: 'block', flexShrink: 0 }}
                    />
                    <span style={relatedPopoverAuthorTextStyle}>
                      {pr.author_login}
                    </span>
                  </span>
                ) : (
                  <GitPullRequestIcon size={12} />
                )}
                <span style={{ ...relatedPopoverStatusTextStyle, color: statusColor }}>
                  {status}
                </span>
                <span style={relatedPopoverTitleStyle}>
                  #{pr.number} {pr.title}
                </span>
              </button>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

const relatedPopoverRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '6px 8px',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  fontFamily: 'inherit',
  fontSize: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};

const relatedPopoverAuthorStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
  minWidth: 0,
  maxWidth: 110,
};

const relatedPopoverAuthorTextStyle: React.CSSProperties = {
  color: 'var(--fg-default)',
  fontSize: 12,
  fontWeight: 500,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const relatedPopoverStatusTextStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'capitalize',
  flexShrink: 0,
};

const relatedPopoverTitleStyle: React.CSSProperties = {
  color: 'var(--fg-default)',
  fontSize: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
};

function highlightRelatedRow(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'var(--bg-emphasis)';
}

function unhighlightRelatedRow(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'transparent';
}
