'use client';

import React, { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/lib/toast';
import { useSn74Repos } from '@/lib/use-sn74-repos';
import type { IssueDto } from '@/lib/api-types';

interface IssuesResp {
  count: number;
  repo_count: number;
  issues: IssueDto[];
}

interface UserReposResp {
  count: number;
  repos: Array<{ full_name: string }>;
}

export default function NewIssuesWatcher() {
  const router = useRouter();
  const { push } = useToast();
  const { weights: sn74Weights, isSuccess: sn74ReposReady } = useSn74Repos();
  // User-added custom repos are tracked separately from the SN74 list but
  // are also intentionally watched. Combining the two gives the watcher
  // its allowlist.
  const { data: userReposData, isSuccess: userReposReady } = useQuery<UserReposResp>({
    queryKey: ['user-repos'],
    queryFn: async ({ signal }) => {
      const r = await fetch('/api/user-repos', { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const baselineRef = useRef<number>(Date.now());
  const baselineIsoRef = useRef<string>(new Date(baselineRef.current).toISOString());
  const seenRef = useRef<Set<string>>(new Set());

  // One-shot preview: append `?demo=collab` or `?demo=owner` to see the
  // sticky priority-author notification. Fires on mount and then strips the
  // param so a refresh doesn't re-trigger it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const demo = params.get('demo');
    if (demo !== 'collab' && demo !== 'owner') return;
    const role = demo === 'owner' ? 'Owner' : 'Collaborator';
    const fakeLogin = demo === 'owner' ? 'demo-owner' : 'demo-collab';
    push({
      title: `★ ${role} opened issue in entrius/allways`,
      body: `#999 — Demo notification: this is what a ${role.toLowerCase()}-authored issue looks like · @${fakeLogin}`,
      onClick: () => {
        router.push(`/explorer?repo=${encodeURIComponent('entrius/allways')}&tab=issues`);
      },
      icon: 'issue',
      variant: 'success',
      ttlMs: 0,
    });
    params.delete('demo');
    const next = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (next ? `?${next}` : '') + window.location.hash);
  }, [push, router]);

  // Once a baseline is set we only ever ask the server for issues seen after
  // that timestamp — typically a near-empty payload instead of the full 4 MB
  // /api/issues dump every tick.
  const sinceParam = baselineIsoRef.current;
  const { data } = useQuery<IssuesResp>({
    queryKey: ['watcher-issues', sinceParam],
    queryFn: async ({ signal }) => {
      const url = `/api/issues?since=${encodeURIComponent(sinceParam)}`;
      const r = await fetch(url, { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    // Tracks the poller (which now refreshes the top-weighted repos every
    // ~20s). Polling at 15s keeps notification latency under ~10s in the
    // worst case while staying off the same boundary as the poller tick.
    refetchInterval: 15000,
    staleTime: 10000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!data) return;
    if (!sn74ReposReady || !userReposReady) return;

    // Allowlist: live SN74 repos plus any user-added custom repos. Issues
    // from anything else (historical cache for repos dropped from upstream,
    // or repos visited via URL but never added) are skipped — we don't want
    // toasts that send the user to a now-empty page.
    const userRepoSet = new Set(
      (userReposData?.repos ?? []).map((r) => r.full_name.toLowerCase()),
    );

    const baseline = baselineRef.current;
    let firedRegular = 0;
    const MAX_PER_TICK = 3;
    for (const i of data.issues) {
      const key = `${i.repo_full_name}#${i.number}`;
      if (seenRef.current.has(key)) continue;

      const slug = i.repo_full_name.toLowerCase();
      if (!sn74Weights.has(slug) && !userRepoSet.has(slug)) continue;
      seenRef.current.add(key);

      // Only toast issues that were actually CREATED on GitHub after the user
      // loaded the dashboard. `first_seen_at` is when our cache first saw it,
      // which fires for back-fills during the poller's initial sweep.
      const createdMs = i.created_at ? new Date(i.created_at).getTime() : 0;
      if (createdMs <= baseline) continue;

      const repoSlug = i.repo_full_name;
      const issueNum = i.number;
      const issueTitle = i.title;
      const assoc = (i.author_association ?? '').toUpperCase();
      const isPriority = assoc === 'OWNER' || assoc === 'COLLABORATOR';

      // Tell RepoExplorer to add a sticky badge for this repo immediately.
      // The `priority` flag on owner/collaborator issues lets the sidebar
      // give that repo row a stand-out highlight (yellow accent border).
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('gittensor-new-content', {
            detail: { repo: repoSlug, kind: 'issue', priority: isPriority },
          })
        );
      }

      if (isPriority) {
        // Owner- and collaborator-filed issues are the highest-value signal
        // for miners — they bypass the per-tick cap and stay on screen until
        // the user explicitly clicks/dismisses them (ttlMs: 0 disables
        // auto-dismiss).
        const role = assoc === 'OWNER' ? 'Owner' : 'Collaborator';
        push({
          title: `★ ${role} opened issue in ${repoSlug}`,
          body: `#${issueNum} — ${issueTitle}${i.author_login ? ` · @${i.author_login}` : ''}`,
          onClick: () => {
            router.push(`/explorer?repo=${encodeURIComponent(repoSlug)}&tab=issues&issue=${issueNum}`);
          },
          icon: 'issue',
          variant: 'success',
          ttlMs: 0,
        });
        continue;
      }

      if (firedRegular >= MAX_PER_TICK) continue;
      firedRegular += 1;

      push({
        title: `New issue in ${repoSlug}`,
        body: `#${issueNum} — ${issueTitle}`,
        onClick: () => {
          router.push(`/explorer?repo=${encodeURIComponent(repoSlug)}&tab=issues&issue=${issueNum}`);
        },
        icon: 'issue',
        variant: 'info',
        ttlMs: 8000,
      });
    }
  }, [data, push, router, sn74Weights, sn74ReposReady, userReposData, userReposReady]);

  return null;
}
