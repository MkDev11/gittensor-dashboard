'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TriangleDownIcon, CheckIcon, SearchIcon } from '@primer/octicons-react';

export interface AuthorOption {
  login: string;
  count: number;
  open?: number;
  completed?: number;
  not_planned?: number;
  closed?: number;
}

/** Pseudo-option pinned to the top of the dropdown — e.g. "Collaborators".
 *  Selecting one passes `value` back via `onChange` so the caller can map it
 *  to a non-author filter (like `?assoc=collaborator`). */
export interface AuthorExtraOption {
  value: string;
  label: string;
  count?: number;
}

interface AuthorFilterProps {
  value: string;
  onChange: (next: string) => void;
  authors: AuthorOption[];
  totalAuthors?: number;
  loading?: boolean;
  onOpen?: () => void;
  width?: number;
  align?: 'left' | 'right';
  ariaLabel?: string;
  extraOptions?: AuthorExtraOption[];
}

export default function AuthorFilter({
  value,
  onChange,
  authors,
  totalAuthors,
  loading = false,
  onOpen,
  width = 200,
  align = 'left',
  ariaLabel = 'Filter by author',
  extraOptions = [],
}: AuthorFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; flipped: boolean; maxHeight: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const displayTotal = totalAuthors ?? authors.length;
  // Reset scroll-tracking state whenever the dropdown opens or the search
  // narrows the list — otherwise a stale scrollTop hides the new top rows.
  useEffect(() => {
    if (!open) return;
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [open, search]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) onOpen?.();
  }, [open, onOpen]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      const w = Math.max(width, r.width, 240);
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      let left = align === 'right' ? r.right - w : r.left;
      if (left + w > viewportW - 8) left = Math.max(8, viewportW - w - 8);
      if (left < 8) left = 8;

      const desired = 380;
      const spaceBelow = viewportH - r.bottom - 8;
      const spaceAbove = r.top - 8;
      let top: number;
      let maxHeight: number;
      let flipped = false;
      if (spaceBelow >= desired || spaceBelow >= spaceAbove) {
        top = r.bottom + 4;
        maxHeight = Math.min(desired, spaceBelow);
      } else {
        const usable = Math.min(desired, spaceAbove);
        top = r.top - 4 - usable;
        maxHeight = usable;
        flipped = true;
      }
      setCoords({ top, left, width: w, flipped, maxHeight });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, width, align]);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return authors;
    return authors.filter((a) => a.login.toLowerCase().includes(q));
  }, [search, authors]);

  const isFiltered = value !== 'all';
  const selectedAuthor = authors.find((a) => a.login === value);
  const selectedExtra = extraOptions.find((o) => o.value === value);
  const triggerLabel = isFiltered
    ? selectedExtra?.label ?? selectedAuthor?.login ?? value
    : `All authors (${displayTotal})`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          height: 28,
          background: open ? 'var(--bg-emphasis)' : 'var(--bg-canvas)',
          border: '1px solid',
          borderColor: open
            ? 'var(--accent-emphasis)'
            : isFiltered
            ? 'var(--accent-emphasis)'
            : 'var(--border-default)',
          borderRadius: 6,
          color: 'var(--fg-default)',
          fontSize: 12,
          fontWeight: 500,
          fontFamily: 'inherit',
          cursor: 'pointer',
          minWidth: 0,
          maxWidth: 200,
          flexShrink: 1,
          overflow: 'hidden',
          boxShadow: open ? '0 0 0 3px var(--accent-glow)' : 'none',
        }}
      >
        {isFiltered && selectedAuthor ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://github.com/${selectedAuthor.login}.png?size=40`}
              alt={selectedAuthor.login}
              style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0 }}
            />
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {triggerLabel}
            </span>
          </>
        ) : isFiltered && selectedExtra ? (
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {triggerLabel}
          </span>
        ) : (
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {triggerLabel}
          </span>
        )}
        <TriangleDownIcon size={12} />
      </button>

      {mounted && open && coords &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              width: coords.width,
              maxHeight: coords.maxHeight,
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-default)',
              borderRadius: 6,
              boxShadow: 'var(--shadow-overlay)',
              zIndex: 9500,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              fontFamily: 'inherit',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 10px',
                borderBottom: '1px solid var(--border-muted)',
              }}
            >
              <SearchIcon size={12} />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter authors…"
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--fg-default)',
                  fontSize: 13,
                  fontFamily: 'inherit',
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--fg-muted)',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  ×
                </button>
              )}
            </div>
            <VirtualList
              listRef={listRef}
              onScroll={setScrollTop}
              scrollTop={scrollTop}
              items={filtered}
              extras={search.trim() ? [] : extraOptions}
              loading={loading}
              isFiltered={isFiltered}
              total={displayTotal}
              value={value}
              onPickAll={() => {
                onChange('all');
                setOpen(false);
              }}
              onPick={(login) => {
                onChange(login);
                setOpen(false);
              }}
            />
          </div>,
          document.body
        )}
    </>
  );
}

// Fixed row height keeps virtualization math simple — must match the height
// produced by AuthorRow's CSS (padding 6px top/bottom + ~20px content).
const ROW_HEIGHT = 32;
const OVERSCAN = 6;

function VirtualList({
  listRef,
  onScroll,
  scrollTop,
  items,
  extras,
  loading,
  isFiltered,
  total,
  value,
  onPickAll,
  onPick,
}: {
  listRef: React.RefObject<HTMLDivElement>;
  onScroll: (px: number) => void;
  scrollTop: number;
  items: AuthorOption[];
  extras: AuthorExtraOption[];
  loading: boolean;
  isFiltered: boolean;
  total: number;
  value: string;
  onPickAll: () => void;
  onPick: (login: string) => void;
}) {
  const [viewportH, setViewportH] = useState(380);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const updateH = () => setViewportH(el.clientHeight);
    updateH();
    const ro = new ResizeObserver(updateH);
    ro.observe(el);
    return () => ro.disconnect();
  }, [listRef]);

  const visibleCount = Math.max(1, Math.ceil(viewportH / ROW_HEIGHT));
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(items.length, startIdx + visibleCount + OVERSCAN * 2);
  const topPad = startIdx * ROW_HEIGHT;
  const bottomPad = Math.max(0, (items.length - endIdx) * ROW_HEIGHT);
  const slice = items.slice(startIdx, endIdx);

  return (
    <div
      ref={listRef}
      onScroll={(e) => onScroll((e.target as HTMLDivElement).scrollTop)}
      style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}
    >
      <AuthorRow
        isAll
        selected={!isFiltered}
        onClick={onPickAll}
        label={`All authors (${total})`}
      />
      {extras.length > 0 && (
        <>
          {extras.map((opt) => (
            <AuthorRow
              key={`extra:${opt.value}`}
              isExtra
              selected={value === opt.value}
              onClick={() => onPick(opt.value)}
              label={opt.label}
              count={opt.count}
            />
          ))}
          <div
            aria-hidden
            style={{
              height: 1,
              background: 'var(--border-muted)',
              margin: '4px 8px',
            }}
          />
        </>
      )}
      {loading && items.length === 0 && (
        <div style={{ padding: '12px 16px', color: 'var(--fg-muted)', fontSize: 12, textAlign: 'center' }}>
          Loading authors…
        </div>
      )}
      {!loading && items.length === 0 && (
        <div style={{ padding: '12px 16px', color: 'var(--fg-muted)', fontSize: 12, textAlign: 'center' }}>
          No matching authors
        </div>
      )}
      {topPad > 0 && <div style={{ height: topPad }} aria-hidden />}
      {slice.map((a) => (
        <AuthorRow
          key={a.login}
          selected={a.login === value}
          login={a.login}
          count={a.count}
          open={a.open}
          completed={a.completed}
          notPlanned={a.not_planned}
          closed={a.closed}
          onClick={() => onPick(a.login)}
        />
      ))}
      {bottomPad > 0 && <div style={{ height: bottomPad }} aria-hidden />}
    </div>
  );
}

function AuthorRow({
  isAll,
  isExtra,
  selected,
  login,
  count,
  open,
  completed,
  notPlanned,
  closed,
  label,
  onClick,
}: {
  isAll?: boolean;
  isExtra?: boolean;
  selected: boolean;
  login?: string;
  count?: number;
  open?: number;
  completed?: number;
  notPlanned?: number;
  closed?: number;
  label?: string;
  onClick: () => void;
}) {
  const hasBuckets =
    typeof open === 'number' || typeof completed === 'number' || typeof notPlanned === 'number' || typeof closed === 'number';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        height: 32,
        padding: '0 12px',
        background: 'transparent',
        border: 'none',
        color: 'var(--fg-default)',
        fontSize: 13,
        fontFamily: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--menu-item-hover-bg)';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--menu-item-hover-fg)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-default)';
      }}
    >
      <span
        style={{ width: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--selected-check)' }}
      >
        {selected ? <CheckIcon size={12} /> : null}
      </span>
      {!isAll && !isExtra && login ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://github.com/${login}.png?size=40`}
            alt={login}
            loading="lazy"
            style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0 }}
          />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{login}</span>
          {hasBuckets && (
            <span style={{ display: 'inline-flex', gap: 5, flexShrink: 0 }}>
              <BucketPill label="Open" tone="open" value={open ?? 0} />
              <BucketPill label="Done" tone="done" value={completed ?? 0} />
              <BucketPill label="Not planned" tone="np" value={notPlanned ?? 0} />
              <BucketPill label="Closed" tone="closed" value={closed ?? 0} />
            </span>
          )}
          {typeof count === 'number' && (
            <span style={{ color: 'var(--fg-muted)', fontSize: 12, fontFamily: 'var(--font-mono), ui-monospace, monospace', flexShrink: 0, minWidth: 22, textAlign: 'right', fontWeight: 600 }}>{count}</span>
          )}
        </>
      ) : isExtra ? (
        <>
          <span style={{ flex: 1, fontWeight: 600 }}>{label}</span>
          {typeof count === 'number' && (
            <span style={{ color: 'var(--fg-muted)', fontSize: 11, fontFamily: 'var(--font-mono), ui-monospace, monospace', flexShrink: 0 }}>{count}</span>
          )}
        </>
      ) : (
        <span style={{ flex: 1 }}>{label}</span>
      )}
    </button>
  );
}

/** Solid colored circle/pill showing a per-author state-bucket count. The
 *  column position (Open / Done / NP / Closed) carries the meaning so we
 *  drop the letter prefix and let the colored fill do the work — matches
 *  the badge style used elsewhere in the dashboard. */
function BucketPill({ label, value, tone }: { label: string; value: number; tone: 'open' | 'done' | 'np' | 'closed' }) {
  const dim = value === 0;
  // Solid fills mirror the IssueStatusBadge palette so a glance at the
  // dropdown matches the State chips in the table.
  // Theme-aware tokens so the pills pass WCAG AA in both modes. The earlier
  // dark-tuned 0.40-alpha fills + bright pastel fgs were illegible on white.
  const PALETTE = {
    open: { bg: 'var(--success-subtle)', fg: 'var(--success-fg)' },
    done: { bg: 'var(--done-subtle)', fg: 'var(--done-fg)' },
    np: { bg: 'var(--bg-emphasis)', fg: 'var(--fg-default)' },
    closed: { bg: 'var(--danger-subtle)', fg: 'var(--danger-fg)' },
  } as const;
  const { bg, fg } = PALETTE[tone];
  return (
    <span
      title={`${label}: ${value}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 22,
        minWidth: 22,
        padding: '0 7px',
        borderRadius: 999,
        background: dim ? 'var(--neutral-subtle)' : bg,
        color: dim ? 'var(--fg-muted)' : fg,
        opacity: dim ? 0.6 : 1,
        fontFamily: 'inherit',
        fontSize: 12,
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1,
      }}
    >
      {value}
    </span>
  );
}
