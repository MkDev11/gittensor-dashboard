'use client';

export const dynamic = 'force-dynamic';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageLayout, Heading, Text, Box, TextInput, Label } from '@primer/react';
import { RepoIcon, PlusIcon, TrashIcon, PencilIcon, CheckIcon, XIcon, LockIcon } from '@primer/octicons-react';
import Spinner from '@/components/Spinner';
import { TableRowsSkeleton } from '@/components/Skeleton';
import SearchInput from '@/components/SearchInput';
import { formatRelativeTime } from '@/lib/format';
import { useSession } from '@/lib/settings';
import type { UserRepo } from '@/types/entities';

export default function ManageReposPage() {
  const qc = useQueryClient();
  const { isAdmin } = useSession();
  const [fullName, setFullName] = useState('');
  const [weight, setWeight] = useState('0.01');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editWeight, setEditWeight] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery<{ count: number; repos: UserRepo[] }>({
    queryKey: ['user-repos'],
    queryFn: async () => {
      const r = await fetch('/api/user-repos');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30000,
  });

  const upsertMutation = useMutation({
    mutationFn: async (input: { full_name: string; weight: number; notes: string | null }) => {
      const r = await fetch('/api/user-repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return j;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user-repos'] });
      setFullName('');
      setWeight('0.01');
      setNotes('');
      setError(null);
      setEditing(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (full_name: string) => {
      const r = await fetch(`/api/user-repos?full_name=${encodeURIComponent(full_name)}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-repos'] }),
  });

  const handleAdd = () => {
    setError(null);
    const trimmed = fullName.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
      setError('Repository must be in the form owner/name (e.g. "openai/gpt-3")');
      return;
    }
    const w = parseFloat(weight);
    if (Number.isNaN(w) || w < 0 || w > 1) {
      setError('Weight must be a number between 0 and 1.');
      return;
    }
    upsertMutation.mutate({ full_name: trimmed, weight: w, notes: notes.trim() || null });
  };

  const startEdit = (repo: UserRepo) => {
    setEditing(repo.full_name);
    setEditWeight(repo.weight.toFixed(4));
    setEditNotes(repo.notes ?? '');
  };

  const saveEdit = (full_name: string) => {
    const w = parseFloat(editWeight);
    if (Number.isNaN(w) || w < 0 || w > 1) {
      setError('Weight must be a number between 0 and 1.');
      return;
    }
    upsertMutation.mutate({ full_name, weight: w, notes: editNotes.trim() || null });
  };

  const filtered = (data?.repos ?? []).filter((r) =>
    !search || r.full_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <PageLayout containerWidth="large" padding="normal">
      <PageLayout.Header>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <RepoIcon size={20} />
          <Heading sx={{ fontSize: 4 }}>Manage Repositories</Heading>
        </Box>
        <Text sx={{ color: 'fg.muted' }}>
          Custom repositories tracked in this dashboard. They appear in the Explorer view alongside the SN74 whitelist
          with the weight assigned.
        </Text>
      </PageLayout.Header>
      <PageLayout.Content>
        {!isAdmin && (
          <Box
            sx={{
              mb: 4,
              p: 3,
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 2,
              bg: 'canvas.subtle',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <LockIcon size={16} />
            <Text sx={{ color: 'fg.muted', fontSize: 1 }}>
              Read-only view. Only admins can add, edit, or remove tracked repositories.
            </Text>
          </Box>
        )}
        {isAdmin && (
        <Box
          sx={{
            mb: 4,
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 2,
            bg: 'canvas.subtle',
            p: 3,
          }}
        >
          <Text sx={{ fontWeight: 600, fontSize: 2, mb: 2, display: 'block' }}>Add a repository</Text>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <Box sx={{ flex: '1 1 240px' }}>
              <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block', mb: 1 }}>Repository (owner/name)</Text>
              <TextInput
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="owner/name"
                sx={{ width: '100%' }}
              />
            </Box>
            <Box sx={{ flex: '0 1 120px' }}>
              <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block', mb: 1 }}>Weight (0–1)</Text>
              <TextInput
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="0.01"
                sx={{ width: '100%' }}
              />
            </Box>
            <Box sx={{ flex: '1 1 220px' }}>
              <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block', mb: 1 }}>Notes (optional)</Text>
              <TextInput
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Why are you tracking this?"
                sx={{ width: '100%' }}
              />
            </Box>
            <Box
              as="button"
              onClick={handleAdd}
              disabled={upsertMutation.isPending}
              sx={{
                mt: '20px',
                px: '14px',
                py: '5px',
                height: 32,
                border: '1px solid var(--btn-primary-border)',
                background: 'var(--btn-primary-bg)',
                color: 'var(--btn-primary-fg)',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              {upsertMutation.isPending ? <Spinner size="sm" tone="muted" /> : <PlusIcon size={14} />}
              Add
            </Box>
          </Box>
          {error && (
            <Box sx={{ mt: 2, p: 2, bg: 'danger.subtle', border: '1px solid', borderColor: 'danger.emphasis', borderRadius: 2 }}>
              <Text sx={{ color: 'danger.fg', fontSize: 1 }}>{error}</Text>
            </Box>
          )}
        </Box>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
          <Text sx={{ fontWeight: 600, fontSize: 2 }}>Tracked repositories</Text>
          <Label variant="secondary">{data?.count ?? 0}</Label>
          <Box sx={{ ml: 'auto' }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Filter…" width={260} />
          </Box>
        </Box>

        <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, overflowX: 'auto', overflowY: 'hidden', bg: 'canvas.default' }}>
          <Box as="table" sx={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 1 }}>
            <Box as="thead" sx={{ bg: 'canvas.subtle', borderBottom: '1px solid', borderColor: 'border.default' }}>
              <Box as="tr">
                <Box as="th" sx={{ ...thSx }}>Repository</Box>
                <Box as="th" sx={{ ...thSx, textAlign: 'right' }}>Weight</Box>
                <Box as="th" sx={thSx}>Notes</Box>
                <Box as="th" sx={thSx}>Added</Box>
                <Box as="th" sx={{ ...thSx, width: 110 }}>Actions</Box>
              </Box>
            </Box>
            <Box as="tbody">
              {isLoading && (
                <Box as="tr">
                  <Box as="td" colSpan={5} sx={{ p: 0 }}>
                    <TableRowsSkeleton
                      rows={6}
                      cols={[
                        { flex: 1 },
                        { width: 60 },
                        { width: 60 },
                        { width: 100 },
                        { width: 110 },
                      ]}
                    />
                  </Box>
                </Box>
              )}
              {!isLoading && filtered.length === 0 && (
                <Box as="tr">
                  <Box as="td" colSpan={5} sx={{ p: 4, textAlign: 'center', color: 'fg.muted' }}>
                    {isAdmin ? 'No custom repositories yet — use the form above to add one.' : 'No custom repositories yet.'}
                  </Box>
                </Box>
              )}
              {filtered.map((r) => (
                <Box
                  as="tr"
                  key={r.full_name}
                  sx={{ borderBottom: '1px solid', borderColor: 'border.muted', '&:hover': { bg: 'canvas.subtle' } }}
                >
                  <Box as="td" sx={{ p: 2 }}>
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      <RepoIcon size={14} />
                      <a href={`https://github.com/${r.full_name}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-fg)', textDecoration: 'none' }}>
                        {r.full_name}
                      </a>
                    </Box>
                  </Box>
                  <Box as="td" sx={{ p: 2, textAlign: 'right', fontFamily: 'mono' }}>
                    {editing === r.full_name ? (
                      <TextInput value={editWeight} onChange={(e) => setEditWeight(e.target.value)} sx={{ width: 90 }} />
                    ) : (
                      r.weight.toFixed(4)
                    )}
                  </Box>
                  <Box as="td" sx={{ p: 2, color: 'fg.muted' }}>
                    {editing === r.full_name ? (
                      <TextInput value={editNotes} onChange={(e) => setEditNotes(e.target.value)} sx={{ width: '100%' }} />
                    ) : (
                      r.notes || <Text sx={{ color: 'fg.subtle' }}>—</Text>
                    )}
                  </Box>
                  <Box as="td" sx={{ p: 2, color: 'fg.muted', fontSize: 0, whiteSpace: 'nowrap' }}>
                    {formatRelativeTime(r.added_at)}
                  </Box>
                  <Box as="td" sx={{ p: 2 }}>
                    {isAdmin ? (
                      <Box sx={{ display: 'inline-flex', gap: 1 }}>
                        {editing === r.full_name ? (
                          <>
                            <IconBtn icon={<CheckIcon size={14} />} onClick={() => saveEdit(r.full_name)} title="Save" tone="success" />
                            <IconBtn icon={<XIcon size={14} />} onClick={() => setEditing(null)} title="Cancel" />
                          </>
                        ) : (
                          <>
                            <IconBtn icon={<PencilIcon size={14} />} onClick={() => startEdit(r)} title="Edit" />
                            <IconBtn
                              icon={<TrashIcon size={14} />}
                              onClick={() => {
                                if (confirm(`Remove ${r.full_name}?`)) deleteMutation.mutate(r.full_name);
                              }}
                              title="Remove"
                              tone="danger"
                            />
                          </>
                        )}
                      </Box>
                    ) : (
                      <Text sx={{ color: 'fg.subtle' }}>—</Text>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      </PageLayout.Content>
    </PageLayout>
  );
}

const thSx = {
  px: 2,
  py: 2,
  textAlign: 'left' as const,
  fontWeight: 600,
  fontSize: '11px',
  color: 'fg.muted',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
};

function IconBtn({
  icon,
  onClick,
  title,
  tone,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  title: string;
  tone?: 'success' | 'danger';
}) {
  const color =
    tone === 'success' ? 'var(--success-fg)' : tone === 'danger' ? 'var(--danger-fg)' : 'var(--fg-muted)';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        padding: 0,
        background: 'var(--bg-canvas)',
        border: '1px solid var(--border-default)',
        color,
        borderRadius: 6,
        cursor: 'pointer',
      }}
    >
      {icon}
    </button>
  );
}
