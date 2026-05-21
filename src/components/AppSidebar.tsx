'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  StackIcon,
  GlobeIcon,
  ChecklistIcon,
  IssueOpenedIcon,
  GitPullRequestIcon,
  BookIcon,
  PeopleIcon,
} from '@primer/octicons-react';
import type { Icon } from '@primer/octicons-react';
import ThemeToggle from '@/components/ThemeToggle';
import UserMenu from '@/components/UserMenu';
import PriceTicker from '@/components/PriceTicker';

interface NavItem {
  href: string;
  label: string;
  icon: Icon;
}

// Primary route switching lives in the sidebar - replaces the prior
// horizontal top-nav with a Linear-style left rail. Docs is grouped at the
// bottom as a "reference" link rather than mixed in with the working pages.
const PRIMARY: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: ChecklistIcon },
  { href: '/explorer', label: 'Explorer', icon: GlobeIcon },
  { href: '/miners', label: 'Miners', icon: PeopleIcon },
  { href: '/repositories', label: 'Repositories', icon: StackIcon },
  { href: '/issues', label: 'Issues', icon: IssueOpenedIcon },
  { href: '/pulls', label: 'Pull Requests', icon: GitPullRequestIcon },
];

const SECONDARY: NavItem[] = [
  { href: '/docs', label: 'Docs', icon: BookIcon },
];

// Routes that should render full-bleed without the sidebar (pre-auth screens).
const HIDE_ROUTES = new Set(['/sign-in']);

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      prefetch={false}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        height: 30,
        padding: '0 10px',
        margin: '0 6px',
        borderRadius: 6,
        textDecoration: 'none',
        // Linear's active treatment is a subtle bg tint, not a font-weight
        // bump - the affordance reads as "this row is selected" rather than
        // "this text is heavier".
        background: active ? 'var(--menu-item-hover-bg)' : 'transparent',
        color: active ? 'var(--fg-default)' : 'var(--fg-muted)',
        fontSize: 13,
        fontWeight: 500,
        lineHeight: '20px',
        transition: 'background 80ms, color 80ms',
      }}
      onMouseEnter={(e) => {
        if (active) return;
        (e.currentTarget as HTMLAnchorElement).style.background = 'var(--menu-item-hover-bg)';
        (e.currentTarget as HTMLAnchorElement).style.color = 'var(--fg-default)';
      }}
      onMouseLeave={(e) => {
        if (active) return;
        (e.currentTarget as HTMLAnchorElement).style.background = 'transparent';
        (e.currentTarget as HTMLAnchorElement).style.color = 'var(--fg-muted)';
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          flexShrink: 0,
          color: active ? 'var(--accent-fg)' : 'var(--fg-subtle)',
        }}
      >
        <Icon size={16} />
      </span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.label}
      </span>
    </Link>
  );
}

export default function AppSidebar() {
  const pathname = usePathname();
  // AppShell handles route-based hiding + the body `data-no-sidebar`
  // attribute. We keep the route guard here too in case the component is
  // ever rendered outside AppShell.
  if (HIDE_ROUTES.has(pathname)) return null;

  return (
    <aside
      // NB: `display: flex; flex-direction: column` lives in globals.css
      // under `[data-app-sidebar]`. If it's inline here, it wins over the
      // CSS `display: none` hide rule and the sidebar still renders in
      // top-nav mode.
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: 240,
        background: 'var(--bg-canvas)',
        borderRight: '1px solid var(--border-muted)',
        // Above PollerStatusBar (z 50) so the sidebar's right border draws
        // cleanly even if a future change moves the status bar's left edge.
        zIndex: 60,
        userSelect: 'none',
      }}
      aria-label="Primary navigation"
      data-app-sidebar=""
    >
      {/* Brand */}
      <Link
        href="/dashboard"
        prefetch={false}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '16px 16px 14px',
          textDecoration: 'none',
          color: 'var(--fg-default)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/gt-logo.png" alt="" width={28} height={28} style={{ display: 'block' }} />
        <span
          style={{
            fontWeight: 600,
            fontSize: 16,
            letterSpacing: '-0.015em',
          }}
        >
          Gittensor Hub
        </span>
      </Link>

      {/* Primary nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
        {PRIMARY.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
        ))}
      </nav>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Secondary nav (reference / docs) */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {SECONDARY.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
        ))}
      </nav>

      {/* Footer chrome: price ticker, theme toggle, user menu */}
      <div
        style={{
          borderTop: '1px solid var(--border-muted)',
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          marginTop: 6,
        }}
      >
        <PriceTicker />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            minWidth: 0,
          }}
        >
          <UserMenu maxWidth={156} />
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
