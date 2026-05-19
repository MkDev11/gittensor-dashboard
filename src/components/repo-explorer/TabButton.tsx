import React from 'react';

export function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
  newCount = 0,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
  newCount?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 16px',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid var(--attention-emphasis)' : '2px solid transparent',
        color: active ? 'var(--fg-default)' : 'var(--fg-muted)',
        fontSize: 14,
        fontWeight: active ? 600 : 500,
        fontFamily: 'inherit',
        cursor: 'pointer',
        marginBottom: 0,
        transition: 'color 80ms, border-color 80ms',
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-default)';
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-muted)';
      }}
    >
      {icon}
      {label}
      {typeof count === 'number' && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0 6px',
            background: 'var(--bg-emphasis)',
            border: '1px solid var(--border-default)',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 500,
            minWidth: 20,
            justifyContent: 'center',
          }}
        >
          {count}
        </span>
      )}
      {newCount > 0 && (
        <span
          title={`${newCount} new since you last viewed this tab`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 6px',
            height: 18,
            minWidth: 18,
            background: 'var(--danger-emphasis)',
            color: '#ffffff',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            lineHeight: 1,
            boxShadow: '0 0 0 2px var(--bg-canvas)',
            animation: 'badgePulse 2s ease-in-out infinite',
          }}
        >
          {newCount > 99 ? '99+' : newCount}
        </span>
      )}
    </button>
  );
}
