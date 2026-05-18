'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';

interface Prices {
  tao_usd: number;
  alpha_tao: number;
  alpha_usd: number;
  fetched_at: number;
  source?: string;
}

function fmtUsd(n: number): string {
  if (!n) return '—';
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function fmtTao(n: number): string {
  if (!n) return '—';
  if (n >= 1) return `${n.toFixed(3)}τ`;
  return `${n.toFixed(6)}τ`;
}

interface PriceTickerProps {
  variant?: 'chip' | 'mobile-strip';
}

export default function PriceTicker({ variant = 'chip' }: PriceTickerProps) {
  const { data } = useQuery<Prices>({
    queryKey: ['prices'],
    queryFn: async () => {
      const r = await fetch('/api/prices');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (!data) {
    if (variant === 'mobile-strip') {
      return (
        <div
          style={{
            width: '100%',
            minWidth: 0,
            height: 36,
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            alignItems: 'center',
            gap: 6,
            padding: 3,
            border: '1px solid var(--border-muted)',
            borderRadius: 8,
            background: 'var(--bg-inset)',
            fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, monospace',
          }}
        >
          <QuoteSkeleton />
          <QuoteSkeleton />
        </div>
      );
    }

    // Reserve the ticker's footprint with skeleton bars so the chrome
    // doesn't briefly collapse during the initial /api/prices fetch.
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          padding: '4px 10px',
          height: 32,
          border: '1px solid var(--border-default)',
          borderRadius: 6,
          background: 'var(--bg-canvas)',
        }}
      >
        <span className="gt-skeleton" style={{ width: 60, height: 10 }} />
        <span style={{ color: 'var(--border-default)' }}>·</span>
        <span className="gt-skeleton" style={{ width: 50, height: 10 }} />
      </div>
    );
  }
  const ageSec = Math.max(0, Math.floor((Date.now() - data.fetched_at) / 1000));
  const tooltip = `TAO ${fmtUsd(data.tao_usd)} · α(SN74) ${fmtUsd(data.alpha_usd)} (${fmtTao(data.alpha_tao)} TAO) · updated ${ageSec}s ago`;

  if (variant === 'mobile-strip') {
    return (
      <div
        title={tooltip}
        style={{
          width: '100%',
          minWidth: 0,
          height: 36,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          alignItems: 'center',
          gap: 6,
          padding: 3,
          border: '1px solid var(--border-muted)',
          borderRadius: 8,
          background: 'var(--bg-inset)',
          color: 'var(--fg-default)',
          fontSize: 12,
          fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, monospace',
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          userSelect: 'none',
        }}
      >
        <MarketValue label="TAO" value={fmtUsd(data.tao_usd)} accent="var(--accent-fg)" />
        <MarketValue label="α74" value={fmtUsd(data.alpha_usd)} accent="var(--success-fg)" />
      </div>
    );
  }

  return (
    <div
      title={tooltip}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '4px 10px',
        height: 32,
        border: '1px solid var(--border-default)',
        borderRadius: 6,
        background: 'var(--bg-canvas)',
        color: 'var(--fg-default)',
        fontSize: 12,
        fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, monospace',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ color: 'var(--fg-muted)', fontSize: 10, fontWeight: 600, letterSpacing: 0 }}>TAO</span>
        <span style={{ color: 'var(--fg-default)', fontWeight: 700 }}>{fmtUsd(data.tao_usd)}</span>
      </span>
      <span style={{ color: 'var(--border-default)' }}>·</span>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ color: 'var(--fg-muted)', fontSize: 10, fontWeight: 600, letterSpacing: 0 }}>α74</span>
        <span style={{ color: 'var(--fg-default)', fontWeight: 700 }}>{fmtUsd(data.alpha_usd)}</span>
      </span>
    </div>
  );
}

function MarketValue({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <span
      style={{
        minWidth: 0,
        display: 'inline-flex',
        height: 28,
        alignItems: 'center',
        gap: 6,
        padding: '0 8px',
        border: '1px solid var(--border-muted)',
        borderRadius: 6,
        background: 'var(--bg-subtle)',
        overflow: 'hidden',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 2,
          height: 14,
          borderRadius: 999,
          background: accent,
          flexShrink: 0,
        }}
      />
      <span style={{ color: 'var(--fg-subtle)', fontSize: 10, fontWeight: 800, letterSpacing: 0, flexShrink: 0 }}>
        {label}
      </span>
      <span
        style={{
          minWidth: 0,
          marginLeft: 'auto',
          color: 'var(--fg-default)',
          fontSize: 13,
          fontWeight: 800,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </span>
    </span>
  );
}

function QuoteSkeleton() {
  return (
    <span
      style={{
        minWidth: 0,
        height: 28,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 8px',
        border: '1px solid var(--border-muted)',
        borderRadius: 6,
        background: 'var(--bg-subtle)',
        overflow: 'hidden',
      }}
    >
      <span className="gt-skeleton" style={{ width: 2, height: 14, flexShrink: 0 }} />
      <span className="gt-skeleton" style={{ width: 24, height: 9, flexShrink: 0 }} />
      <span className="gt-skeleton" style={{ width: '100%', maxWidth: 64, height: 10, marginLeft: 'auto' }} />
    </span>
  );
}
