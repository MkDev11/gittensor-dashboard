'use client';

export const dynamic = 'force-dynamic';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageLayout, Heading, Text, Box, Label } from '@primer/react';
import { CheckIcon, XIcon, ShieldLockIcon, PersonIcon, PersonAddIcon } from '@primer/octicons-react';
import { TableRowsSkeleton } from '@/components/Skeleton';
import { formatRelativeTime } from '@/lib/format';

interface AdminUser {
  id: number;
  github_id: string;
  github_login: string;
  avatar_url: string | null;
  status: 'pending' | 'approved' | 'rejected';
  is_admin: boolean;
  created_at: string;
  last_login_at: string | null;
  approved_at: string | null;
}

interface AdminUsersResponse {
  me: { id: number; github_login: string };
  users: AdminUser[];
}

type Tab = 'pending' | 'approved' | 'rejected';

export default function AdminUsersPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('pending');
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<AdminUsersResponse>({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const r = await fetch('/api/admin/users', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 10_000,
  });

  const runAction = (path: string) => async (id: number) => {
    setActionError(null);
    const r = await fetch(`/api/admin/users/${id}/${path}`, { method: 'POST' });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${r.status}`);
    }
    return r.json();
  };

  const onUserMutation = () => {
    void qc.invalidateQueries({ queryKey: ['admin-users'] });
    void qc.invalidateQueries({ queryKey: ['watcher-pending-users'] });
  };

  const approve = useMutation({
    mutationFn: runAction('approve'),
    onSuccess: onUserMutation,
    onError: (e: Error) => setActionError(e.message),
  });
  const reject = useMutation({
    mutationFn: runAction('reject'),
    onSuccess: onUserMutation,
    onError: (e: Error) => setActionError(e.message),
  });
  const promote = useMutation({
    mutationFn: runAction('promote'),
    onSuccess: onUserMutation,
    onError: (e: Error) => setActionError(e.message),
  });
  const demote = useMutation({
    mutationFn: runAction('demote'),
    onSuccess: onUserMutation,
    onError: (e: Error) => setActionError(e.message),
  });

  const users = data?.users ?? [];
  const meId = data?.me.id;
  const adminCount = users.filter((u) => u.is_admin).length;
  const pending = approve.isPending || reject.isPending || promote.isPending || demote.isPending;
  const counts = {
    pending: users.filter((u) => u.status === 'pending').length,
    approved: users.filter((u) => u.status === 'approved').length,
    rejected: users.filter((u) => u.status === 'rejected').length,
  };
  const visible = users.filter((u) => u.status === tab);

  return (
    <PageLayout containerWidth="xlarge" padding="normal">
      <PageLayout.Header>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
          <ShieldLockIcon size={24} />
          <Heading sx={{ fontSize: 4, m: 0 }}>User access</Heading>
        </Box>
        <Text sx={{ color: 'fg.muted' }}>Approve or reject GitHub sign-ins.</Text>
      </PageLayout.Header>
      <PageLayout.Content>
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 1,
            mb: 3,
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 2,
            p: '4px',
            bg: 'canvas.subtle',
          }}
        >
          {(['pending', 'approved', 'rejected'] as Tab[]).map((t) => (
            <Box
              as="button"
              key={t}
              onClick={() => setTab(t)}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1,
                px: 3,
                py: '6px',
                border: 'none',
                bg: tab === t ? 'canvas.default' : 'transparent',
                color: tab === t ? 'fg.default' : 'fg.muted',
                fontSize: 1,
                fontWeight: tab === t ? 600 : 500,
                borderRadius: 1,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textTransform: 'capitalize',
                '&:hover': { color: 'fg.default' },
              }}
            >
              {t}
              <Text sx={{ color: 'fg.muted', fontWeight: 500, fontFamily: 'mono' }}>{counts[t]}</Text>
            </Box>
          ))}
        </Box>

        {isError && (
          <Box sx={{ p: 3, bg: 'danger.subtle', color: 'danger.fg', border: '1px solid', borderColor: 'danger.muted', borderRadius: 2 }}>
            Failed to load users.
          </Box>
        )}

        {actionError && (
          <Box
            sx={{
              p: 2,
              mb: 3,
              bg: 'danger.subtle',
              color: 'danger.fg',
              border: '1px solid',
              borderColor: 'danger.muted',
              borderRadius: 2,
              fontSize: 1,
            }}
          >
            {actionError}
          </Box>
        )}

        {isLoading && !data && (
          <TableRowsSkeleton
            rows={10}
            cols={[
              { width: 36, flex: 0 },
              { flex: 1 },
              { width: 80 },
              { width: 80 },
              { width: 100 },
              { width: 100 },
            ]}
          />
        )}

        {data && (
          <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, bg: 'canvas.subtle', overflowX: 'auto', overflowY: 'hidden' }}>
            <Box as="table" sx={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 1 }}>
              <Box as="thead" sx={{ bg: 'canvas.subtle', borderBottom: '1px solid', borderColor: 'border.default' }}>
                <Box as="tr">
                  <Th>USER</Th>
                  <Th>GITHUB ID</Th>
                  <Th>SIGNED UP</Th>
                  <Th>LAST LOGIN</Th>
                  <Th align="right">ACTIONS</Th>
                </Box>
              </Box>
              <Box as="tbody">
                {visible.length === 0 && (
                  <Box as="tr">
                    <Box as="td" colSpan={5} sx={{ p: 4, textAlign: 'center', color: 'fg.muted' }}>
                      No {tab} users.
                    </Box>
                  </Box>
                )}
                {visible.map((u) => (
                  <Box
                    as="tr"
                    key={u.id}
                    sx={{
                      borderBottom: '1px solid',
                      borderColor: 'border.muted',
                      '&:last-child': { borderBottom: 'none' },
                      '&:hover': { bg: 'canvas.default' },
                    }}
                  >
                    <Box as="td" sx={{ p: 2, verticalAlign: 'middle' }}>
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        {u.avatar_url && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={u.avatar_url}
                            alt={u.github_login}
                            width={24}
                            height={24}
                            style={{ borderRadius: '50%', border: '1px solid var(--border-muted)' }}
                          />
                        )}
                        <Text sx={{ fontFamily: 'mono', fontWeight: 600 }}>{u.github_login}</Text>
                        {u.is_admin && (
                          <Label variant="accent" sx={{ fontSize: '10px' }}>
                            ADMIN
                          </Label>
                        )}
                      </Box>
                    </Box>
                    <Box as="td" sx={{ p: 2, verticalAlign: 'middle' }}>
                      <Text sx={{ fontFamily: 'mono', color: 'fg.muted' }}>{u.github_id}</Text>
                    </Box>
                    <Box as="td" sx={{ p: 2, verticalAlign: 'middle', color: 'fg.muted' }}>
                      <Text>{formatRelativeTime(u.created_at)}</Text>
                    </Box>
                    <Box as="td" sx={{ p: 2, verticalAlign: 'middle', color: 'fg.muted' }}>
                      <Text>{u.last_login_at ? formatRelativeTime(u.last_login_at) : '—'}</Text>
                    </Box>
                    <Box as="td" sx={{ p: 2, textAlign: 'right', verticalAlign: 'middle' }}>
                      <Box sx={{ display: 'inline-flex', gap: 1 }}>
                        {u.status !== 'approved' && !u.is_admin && (
                          <ActionBtn
                            tone="success"
                            onClick={() => approve.mutate(u.id)}
                            disabled={pending}
                            label="Approve"
                            icon={<CheckIcon size={14} />}
                          />
                        )}
                        {u.status !== 'rejected' && !u.is_admin && (
                          <ActionBtn
                            tone="danger"
                            onClick={() => reject.mutate(u.id)}
                            disabled={pending}
                            label="Reject"
                            icon={<XIcon size={14} />}
                          />
                        )}
                        {!u.is_admin && (
                          <ActionBtn
                            tone="accent"
                            onClick={() => promote.mutate(u.id)}
                            disabled={pending}
                            label="Make admin"
                            icon={<PersonAddIcon size={14} />}
                          />
                        )}
                        {u.is_admin && meId !== u.id && adminCount > 1 && (
                          <ActionBtn
                            tone="neutral"
                            onClick={() => demote.mutate(u.id)}
                            disabled={pending}
                            label="Demote"
                            icon={<PersonIcon size={14} />}
                          />
                        )}
                      </Box>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        )}
      </PageLayout.Content>
    </PageLayout>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <Box
      as="th"
      sx={{
        p: 2,
        textAlign: align,
        fontSize: '11px',
        color: 'fg.muted',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}

type ActionTone = 'success' | 'danger' | 'accent' | 'neutral';

const TONE_PALETTE: Record<ActionTone, { fg: string; border: string; bgHover: string }> = {
  success: { fg: 'success.fg', border: 'success.muted', bgHover: 'success.subtle' },
  danger: { fg: 'danger.fg', border: 'danger.muted', bgHover: 'danger.subtle' },
  accent: { fg: 'accent.fg', border: 'accent.muted', bgHover: 'accent.subtle' },
  neutral: { fg: 'fg.default', border: 'border.default', bgHover: 'canvas.subtle' },
};

function ActionBtn({
  tone,
  onClick,
  disabled,
  label,
  icon,
}: {
  tone: ActionTone;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  const { fg, border, bgHover } = TONE_PALETTE[tone];
  return (
    <Box
      as="button"
      onClick={onClick}
      disabled={disabled}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: '4px',
        bg: 'transparent',
        color: fg,
        border: '1px solid',
        borderColor: border,
        borderRadius: 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontFamily: 'inherit',
        fontSize: 0,
        fontWeight: 600,
        '&:hover': disabled ? undefined : { bg: bgHover },
      }}
    >
      {icon}
      {label}
    </Box>
  );
}
