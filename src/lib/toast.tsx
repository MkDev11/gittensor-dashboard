'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';
import { Box } from '@primer/react';
import { XIcon, IssueOpenedIcon, GitPullRequestIcon, BellIcon } from '@primer/octicons-react';

export type ToastVariant = 'info' | 'success' | 'warning' | 'danger';
export type ToastIcon = 'issue' | 'pull' | 'bell';

export interface Toast {
  id: string;
  title: string;
  body?: string;
  href?: string;
  onClick?: () => void;
  variant?: ToastVariant;
  icon?: ToastIcon;
  ttlMs?: number;
}

interface ToastCtx {
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast must be used inside ToastProvider');
  return c;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const toast: Toast = { id, ttlMs: 7000, variant: 'info', ...t };
      setToasts((cur) => [...cur.slice(-8), toast]);
      if (toast.ttlMs && toast.ttlMs > 0) {
        setTimeout(() => dismiss(id), toast.ttlMs);
      }
    },
    [dismiss]
  );

  return (
    <Ctx.Provider value={{ push, dismiss }}>
      {children}
      <Box
        sx={{
          position: 'fixed',
          left: [2, null, 'auto'],
          right: [2, null, 16],
          bottom: ['calc(var(--bottom-nav-height, 0px) + 42px)', null, 16],
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          width: ['auto', null, 380],
          maxWidth: ['calc(100vw - 16px)', null, 380],
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </Box>
    </Ctx.Provider>
  );
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const variant = toast.variant ?? 'info';
  const variantStyle = {
    info: { border: 'accent.emphasis', bar: 'accent.emphasis' },
    success: { border: 'success.emphasis', bar: 'success.emphasis' },
    warning: { border: 'attention.emphasis', bar: 'attention.emphasis' },
    danger: { border: 'danger.emphasis', bar: 'danger.emphasis' },
  }[variant];

  const Icon = toast.icon === 'issue' ? IssueOpenedIcon : toast.icon === 'pull' ? GitPullRequestIcon : BellIcon;

  const inner = (
    <Box
      sx={{
        bg: 'canvas.overlay',
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        boxShadow: 'var(--shadow-overlay)',
        p: [2, 3],
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        gridTemplateAreas: "'icon title close' 'bar body body'",
        columnGap: 2,
        rowGap: 1,
        alignItems: 'start',
        overflow: 'hidden',
        position: 'relative',
        pointerEvents: 'auto',
        animation: 'slideUp 200ms ease',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          borderLeft: ['none', null, '3px solid'],
          borderLeftColor: variantStyle.bar,
          borderTop: ['3px solid', null, 'none'],
          borderTopColor: variantStyle.bar,
          pointerEvents: 'none',
        },
        '@keyframes slideUp': {
          from: { opacity: 0, transform: 'translateY(8px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
      }}
    >
      <Box
        sx={{
          gridArea: 'icon',
          width: 28,
          height: 28,
          borderRadius: '50%',
          bg: 'canvas.inset',
          color: variantStyle.bar,
          border: '1px solid',
          borderColor: 'border.default',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon size={16} />
      </Box>
      <Box sx={{ gridArea: 'title', minWidth: 0, alignSelf: 'center' }}>
        <span
          style={{
            fontWeight: 700,
            color: 'var(--fg-default)',
            display: '-webkit-box',
            fontSize: 13,
            lineHeight: 1.3,
            overflow: 'hidden',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            wordBreak: 'break-word',
          }}
        >
          {toast.title}
        </span>
      </Box>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={(e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
        style={{
          gridArea: 'close',
          width: 28,
          height: 28,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          borderRadius: 6,
          background: 'transparent',
          color: 'var(--fg-muted)',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <XIcon size={16} />
      </button>
      <Box
        aria-hidden="true"
        sx={{
          gridArea: 'bar',
          justifySelf: 'center',
          width: 2,
          height: '100%',
          minHeight: 28,
          borderRadius: 999,
          bg: variantStyle.bar,
          display: ['none', null, 'block'],
        }}
      />
      {toast.body && (
        <span
          style={{
            gridArea: 'body',
            color: 'var(--fg-muted)',
            fontSize: 12,
            lineHeight: 1.35,
            display: '-webkit-box',
            overflow: 'hidden',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            wordBreak: 'break-word',
          }}
        >
          {toast.body}
        </span>
      )}
    </Box>
  );

  if (toast.onClick) {
    // <div role="button"> instead of <button> because `inner` contains an
    // IconButton (the dismiss X), and nesting <button> inside <button> is
    // invalid HTML — Next 15 surfaces it as a hydration error.
    const activate = () => {
      toast.onClick!();
      onClose();
    };
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
          }
        }}
        style={{
          display: 'block',
          width: '100%',
          cursor: 'pointer',
          textAlign: 'left',
          pointerEvents: 'auto',
        }}
      >
        {inner}
      </div>
    );
  }
  if (toast.href) {
    return (
      <a href={toast.href} style={{ textDecoration: 'none', display: 'block', pointerEvents: 'auto' }}>
        {inner}
      </a>
    );
  }
  return inner;
}
