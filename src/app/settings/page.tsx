'use client';

export const dynamic = 'force-dynamic';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageLayout, Heading, Text, Box } from '@primer/react';
import Spinner from '@/components/Spinner';
import { GearIcon, PaintbrushIcon, BellIcon, RepoIcon, PersonIcon, EyeIcon, ArrowLeftIcon } from '@primer/octicons-react';
import { useSettings, DEFAULT_SETTINGS, useSession } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import Dropdown from '@/components/Dropdown';

export default function SettingsPage() {
  const router = useRouter();
  const { settings, update, reset } = useSettings();
  const { theme, setTheme } = useTheme();

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/');
    }
  };

  const { username, avatarUrl, loading: sessionLoading } = useSession();

  return (
    <PageLayout containerWidth="large" padding="normal">
      <PageLayout.Header>
        <button
          type="button"
          onClick={handleBack}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 10px',
            border: '1px solid var(--border-default)',
            borderRadius: 6,
            background: 'var(--bg-canvas)',
            color: 'var(--fg-muted)',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'inherit',
            marginBottom: 16,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-strong)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-default)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-default)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-muted)';
          }}
        >
          <ArrowLeftIcon size={14} />
          Back
        </button>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <GearIcon size={20} />
          <Heading sx={{ fontSize: 4 }}>Settings</Heading>
        </Box>
        <Text sx={{ color: 'fg.muted' }}>Customize the dashboard. All preferences are stored locally in your browser.</Text>
      </PageLayout.Header>
      <PageLayout.Content>
        {/* Profile */}
        <Section title="Profile" icon={<PersonIcon size={16} />}>
          {sessionLoading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'fg.muted' }}>
              <Spinner size="sm" tone="muted" />
              <Text>Loading…</Text>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={username ?? ''}
                  style={{ width: 64, height: 64, borderRadius: '50%', display: 'block', flexShrink: 0 }}
                />
              ) : (
                <Box
                  sx={{
                    display: 'inline-flex',
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    bg: 'var(--accent-emphasis)',
                    color: 'white',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 28,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {(username ?? '?').charAt(0).toUpperCase()}
                </Box>
              )}
              <Box>
                <Text sx={{ fontSize: 3, fontWeight: 600, display: 'block' }}>{username ?? '—'}</Text>
                <Text sx={{ color: 'fg.muted', fontSize: 1 }}>
                  Signed in via GitHub
                </Text>
              </Box>
            </Box>
          )}
        </Section>

        {/* Appearance */}
        <Section title="Appearance" icon={<PaintbrushIcon size={16} />}>
          <Field label="Theme" hint="Light or dark color scheme.">
            <Dropdown
              value={theme}
              onChange={(v) => setTheme(v as 'light' | 'dark')}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ]}
              width={200}
              ariaLabel="Theme"
            />
          </Field>
          <Field label="Layout" hint="Where the primary navigation lives — a left sidebar or a horizontal header at the top.">
            <Dropdown
              value={settings.layout}
              onChange={(v) => update('layout', v as 'sidebar' | 'top-nav')}
              options={[
                { value: 'sidebar', label: 'Sidebar' },
                { value: 'top-nav', label: 'Header' },
              ]}
              width={200}
              ariaLabel="Layout"
            />
          </Field>
          <Field label="Show labels in tables" hint="Inline label chips on issues — turn off for a denser table.">
            <Toggle value={settings.showLabelsInTable} onChange={(v) => update('showLabelsInTable', v)} />
          </Field>
        </Section>

        {/* Browsing defaults */}
        <Section title="Browsing defaults" icon={<RepoIcon size={16} />}>
          <Field label="Default issue state filter">
            <Dropdown
              value={settings.defaultIssueState}
              onChange={(v) => update('defaultIssueState', v as typeof settings.defaultIssueState)}
              options={[
                { value: 'all', label: 'All states' },
                { value: 'open', label: 'Open' },
                { value: 'completed', label: 'Completed' },
                { value: 'not_planned', label: 'Not planned' },
                { value: 'closed_other', label: 'Closed (other)' },
              ]}
              width={200}
              ariaLabel="Default issue state filter"
            />
          </Field>
          <Field label="Default repo sort">
            <Dropdown
              value={settings.defaultRepoSort}
              onChange={(v) => update('defaultRepoSort', v as typeof settings.defaultRepoSort)}
              options={[
                { value: 'weight', label: 'By weight (highest first)' },
                { value: 'name', label: 'By name (alphabetical)' },
                { value: 'tracked', label: 'Tracked first' },
              ]}
              width={240}
              ariaLabel="Default repo sort"
            />
          </Field>
          <Field
            label="Page size"
            hint="Rows per page in paginated issue and pull request tables."
          >
            <Dropdown
              value={String(settings.pageSize > 0 ? settings.pageSize : 50)}
              onChange={(v) => update('pageSize', parseInt(v, 10))}
              options={[
                { value: '10', label: '10 per page' },
                { value: '25', label: '25 per page' },
                { value: '50', label: '50 per page' },
                { value: '100', label: '100 per page' },
              ]}
              width={220}
              ariaLabel="Page size"
            />
          </Field>
        </Section>

        {/* Content viewer */}
        <Section title="Issue / PR content" icon={<EyeIcon size={16} />}>
          <Field
            label="Display mode"
            hint="How issue and PR bodies open when you click a row in the Explorer view."
          >
            <Dropdown
              value={settings.contentDisplay}
              onChange={(v) => update('contentDisplay', v as 'modal' | 'accordion' | 'side')}
              options={[
                { value: 'modal', label: 'Modal (centered overlay)' },
                { value: 'side', label: 'Side panel (slides from right)' },
                { value: 'accordion', label: 'Inline accordion' },
              ]}
              width={260}
              ariaLabel="Content display mode"
            />
          </Field>
          <Field label="Render markdown" hint="Convert headings, code blocks, lists, and links. Off renders raw text.">
            <Toggle value={settings.renderMarkdown} onChange={(v) => update('renderMarkdown', v)} />
          </Field>
          <Field
            label="Auto-expand first item"
            hint="When using accordion mode, automatically expand the first row of the table."
          >
            <Toggle value={settings.autoExpandFirst} onChange={(v) => update('autoExpandFirst', v)} />
          </Field>
        </Section>

        {/* Notifications */}
        <Section title="Notifications" icon={<BellIcon size={16} />}>
          <Field label="Enable toast notifications" hint="Show a popup when a new GitHub issue is created in any cached repo.">
            <Toggle value={settings.notificationsEnabled} onChange={(v) => update('notificationsEnabled', v)} />
          </Field>
          <Field label="UI tick interval (ms)" hint="How often the UI re-renders cached data. Default 1000ms.">
            <NumberInput
              value={settings.uiTickMs}
              min={500}
              max={30000}
              step={500}
              onChange={(v) => update('uiTickMs', v)}
            />
          </Field>
          <Field label="Show GitHub rate-limit indicator">
            <Toggle value={settings.showRateLimit} onChange={(v) => update('showRateLimit', v)} />
          </Field>
        </Section>

        <Box sx={{ mt: 4, display: 'flex', gap: 2 }}>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '6px 16px',
              border: '1px solid var(--border-default)',
              background: 'var(--bg-canvas)',
              color: 'var(--danger-fg)',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Reset to defaults
          </button>
          <Text sx={{ color: 'fg.muted', fontSize: 0, alignSelf: 'center' }}>
            Stored in <code>localStorage</code> as <code>gittensor.settings</code>
          </Text>
        </Box>
      </PageLayout.Content>
    </PageLayout>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box
      sx={{
        mb: 3,
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          p: 3,
          borderBottom: '1px solid',
          borderColor: 'border.default',
          bg: 'canvas.default',
        }}
      >
        {icon}
        <Text sx={{ fontWeight: 600, fontSize: 2 }}>{title}</Text>
      </Box>
      <Box sx={{ p: 3 }}>{children}</Box>
    </Box>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: ['column', 'row'],
        gap: 3,
        py: 2,
        borderBottom: '1px solid',
        borderColor: 'border.muted',
        '&:last-child': { borderBottom: 'none', pb: 0 },
        '&:first-child': { pt: 0 },
        alignItems: ['stretch', 'center'],
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Text sx={{ fontWeight: 500, display: 'block', fontSize: 1 }}>{label}</Text>
        {hint && <Text sx={{ color: 'fg.muted', fontSize: 0, display: 'block', mt: 1 }}>{hint}</Text>}
      </Box>
      <Box sx={{ flexShrink: 0, alignSelf: ['stretch', 'center'] }}>{children}</Box>
    </Box>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      style={{
        position: 'relative',
        width: 40,
        height: 22,
        background: value ? 'var(--success-emphasis)' : 'var(--border-default)',
        border: 'none',
        borderRadius: 999,
        cursor: 'pointer',
        transition: 'background 120ms',
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: value ? 20 : 2,
          width: 18,
          height: 18,
          background: '#ffffff',
          borderRadius: '50%',
          transition: 'left 120ms',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }}
      />
    </button>
  );
}

function NumberInput({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(parseInt(e.target.value, 10))}
      style={{
        width: 120,
        padding: '5px 12px',
        border: '1px solid var(--border-default)',
        borderRadius: 6,
        background: 'var(--bg-canvas)',
        color: 'var(--fg-default)',
        fontSize: 14,
        fontFamily: 'inherit',
        height: 32,
      }}
    />
  );
}
