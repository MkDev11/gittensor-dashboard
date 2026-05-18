'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Box, Text } from '@primer/react';
import {
  StackIcon,
  IssueOpenedIcon,
  GitPullRequestIcon,
  TelescopeIcon,
  BookIcon,
  PeopleIcon,
  PersonIcon,
  KebabHorizontalIcon,
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

const navItems: NavItem[] = [
  { href: '/', label: 'Explorer', icon: TelescopeIcon },
  { href: '/miners', label: 'Miners', icon: PeopleIcon },
  { href: '/repositories', label: 'Repositories', icon: StackIcon },
  { href: '/issues', label: 'Issues', icon: IssueOpenedIcon },
  { href: '/pulls', label: 'Pull Requests', icon: GitPullRequestIcon },
  { href: '/my-prs', label: 'My PRs', icon: PersonIcon },
  { href: '/docs', label: 'Docs', icon: BookIcon },
];

const mobilePrimaryHrefs = new Set(['/', '/miners', '/repositories', '/issues']);
const mobilePrimaryItems = navItems.filter((item) => mobilePrimaryHrefs.has(item.href));
const mobileOverflowItems = navItems.filter((item) => !mobilePrimaryHrefs.has(item.href));

// Routes that should render full-bleed without the nav header (pre-auth screens).
const HIDE_HEADER_ROUTES = new Set(['/sign-in']);

export default function AppHeader() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href));
  const moreActive = mobileOverflowItems.some((item) => isActive(item.href));

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (moreMenuRef.current?.contains(target)) return;
      if (moreButtonRef.current?.contains(target)) return;
      setMoreOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [moreOpen]);

  if (HIDE_HEADER_ROUTES.has(pathname)) return null;

  // Wrap in a plain div so the `data-app-header` attribute reliably lands
  // on a DOM node — Primer's <Header> doesn't forward arbitrary data
  // attributes, which is why CSS-driven show/hide couldn't target it before.
  // `userSelect: none` prevents nav-item text from getting highlighted on
  // accidental double-clicks (the sidebar applies the same to its <aside>).
  return (
    <div data-app-header="" style={{ position: 'sticky', top: 0, zIndex: 170, userSelect: 'none' }}>
      <Box
        as="header"
        sx={{
          bg: 'var(--bg-subtle)',
          borderBottom: '1px solid',
          borderColor: 'var(--border-default)',
          minHeight: ['96px', null, '64px', null, '64px'],
          px: [2, 3],
          py: ['10px', null, 0, null, 0],
          display: 'grid',
          gridTemplateColumns: ['minmax(0, 1fr) auto', null, 'auto minmax(0, 1fr) auto', null, 'auto minmax(0, 1fr) auto'],
          gridTemplateAreas: [
            "'brand actions' 'ticker ticker'",
            null,
            "'brand ticker actions'",
            null,
            "'brand nav actions'",
          ],
          alignItems: 'center',
          columnGap: [2, 3],
          rowGap: ['6px', null, 0],
        }}
      >
        <Box sx={{ gridArea: 'brand', minWidth: 0, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Link href="/" prefetch={false} style={{ minWidth: 0, textDecoration: 'none' }}>
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 2, minWidth: 0, color: 'var(--fg-default)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/gt-logo.png" alt="Gittensor Hub" width={28} height={28} style={{ display: 'block', flexShrink: 0 }} />
              <Text sx={{ fontWeight: 600, fontSize: 2, letterSpacing: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Gittensor Hub
              </Text>
            </Box>
          </Link>
        </Box>

        <Box
          as="nav"
          aria-label="Primary navigation"
          sx={{
            gridArea: 'nav',
            minWidth: 0,
            display: ['none', null, null, null, 'flex'],
            alignItems: 'center',
            gap: 1,
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          {navItems.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                aria-current={active ? 'page' : undefined}
                style={{ textDecoration: 'none', flexShrink: 0 }}
              >
                <Box
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    height: 32,
                    px: 2,
                    borderRadius: 2,
                    color: active ? 'var(--fg-default)' : 'var(--fg-muted)',
                    bg: active ? 'var(--bg-inset)' : 'transparent',
                    border: '1px solid',
                    borderColor: active ? 'var(--border-default)' : 'transparent',
                    fontSize: 1,
                    fontWeight: active ? 600 : 500,
                    whiteSpace: 'nowrap',
                    '&:hover': { color: 'var(--fg-default)', bg: 'var(--bg-inset)' },
                  }}
                >
                  <Icon size={16} />
                  {item.label}
                </Box>
              </Link>
            );
          })}
        </Box>

        <Box
          sx={{
            gridArea: 'ticker',
            minWidth: 0,
            overflow: 'hidden',
            pt: ['2px', null, 0],
            display: ['block', null, 'flex', null, 'none'],
            justifyContent: ['stretch', null, 'flex-end'],
          }}
        >
          <Box sx={{ display: ['block', null, 'none'] }}>
            <PriceTicker variant="mobile-strip" />
          </Box>
          <Box sx={{ display: ['none', null, 'block'] }}>
            <PriceTicker />
          </Box>
        </Box>

        <Box sx={{ gridArea: 'actions', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2, minWidth: 0 }}>
          <Box sx={{ display: ['none', null, null, null, 'block'] }}>
            <PriceTicker />
          </Box>
          <ThemeToggle />
          <UserMenu />
        </Box>
      </Box>

      <Box
        as="nav"
        aria-label="Mobile primary navigation"
        sx={{
          position: 'fixed',
          left: 'var(--sidebar-width, 0px)',
          right: 0,
          bottom: 0,
          height: 'var(--bottom-nav-height)',
          px: 3,
          pt: '9px',
          pb: 'calc(9px + env(safe-area-inset-bottom))',
          bg: 'var(--bottom-nav-bg)',
          borderTop: '1px solid var(--border-default)',
          borderRadius: 0,
          backdropFilter: 'blur(14px)',
          display: ['grid', null, null, null, 'none'],
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          alignItems: 'stretch',
          gap: 1,
          zIndex: 180,
          boxShadow: 'var(--bottom-nav-shadow)',
        }}
      >
        {mobilePrimaryItems.map((item) => (
          <MobileNavLink key={item.href} href={item.href} label={item.label} icon={item.icon} active={isActive(item.href)} />
        ))}
        <Box sx={{ position: 'relative', minWidth: 0 }}>
          <button
            ref={moreButtonRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-label="More navigation"
            onClick={() => setMoreOpen((open) => !open)}
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              border: 'none',
              borderRadius: 10,
              background: 'transparent',
              color: moreActive || moreOpen ? 'var(--fg-default)' : 'var(--fg-muted)',
              font: 'inherit',
              fontSize: 10,
              fontWeight: moreActive || moreOpen ? 700 : 600,
              lineHeight: 1,
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                width: 32,
                height: 28,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: moreActive || moreOpen ? 'var(--accent-fg)' : 'var(--fg-muted)',
              }}
            >
              <KebabHorizontalIcon size={20} />
            </span>
            <span>More</span>
          </button>
          {moreOpen && (
            <div
              ref={moreMenuRef}
              role="menu"
              style={{
                position: 'fixed',
                right: 12,
                bottom: 'calc(var(--bottom-nav-height) + 10px)',
                minWidth: 210,
                padding: 6,
                border: '1px solid var(--border-default)',
                borderRadius: 8,
                background: 'var(--bg-subtle)',
                boxShadow: 'var(--shadow-overlay)',
                zIndex: 130,
              }}
            >
              {mobileOverflowItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={false}
                    role="menuitem"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '9px 10px',
                      borderRadius: 6,
                      color: active ? 'var(--fg-default)' : 'var(--fg-muted)',
                      background: active ? 'var(--bg-emphasis)' : 'transparent',
                      fontSize: 13,
                      fontWeight: active ? 700 : 600,
                      textDecoration: 'none',
                    }}
                  >
                    <Icon size={16} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}
        </Box>
      </Box>
    </div>
  );
}

function MobileNavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: Icon;
  active: boolean;
}) {
  return (
    <Link href={href} prefetch={false} aria-current={active ? 'page' : undefined} style={{ minWidth: 0, textDecoration: 'none' }}>
      <Box
        sx={{
          height: '100%',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '5px',
          borderRadius: 2,
          color: active ? 'var(--fg-default)' : 'var(--fg-muted)',
          bg: 'transparent',
          fontSize: '10px',
          fontWeight: active ? 700 : 600,
          lineHeight: 1,
          '&:hover': {
            color: active ? 'var(--accent-fg)' : 'var(--fg-default)',
            bg: 'transparent',
          },
        }}
      >
        <span
          style={{
            width: active ? 36 : 32,
            height: active ? 32 : 28,
            transform: active ? 'translateY(-8px)' : 'none',
            borderRadius: 999,
            border: active ? '1px solid var(--border-strong)' : '1px solid transparent',
            background: active ? 'var(--bg-inset)' : 'transparent',
            boxShadow: active ? '0 0 0 2px var(--bg-canvas), 0 8px 18px rgba(0, 0, 0, 0.35)' : 'none',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: active ? 'var(--accent-fg)' : 'var(--fg-muted)',
            transition: 'background 120ms, border-color 120ms, color 120ms, transform 120ms',
          }}
        >
          <Icon size={active ? 18 : 20} />
        </span>
        <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label === 'Repositories' ? 'Repos' : label}
        </span>
      </Box>
    </Link>
  );
}
