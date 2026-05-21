'use client';

import React from 'react';
import { Box, Text } from '@primer/react';
import {
  DiffAddedIcon, DiffRemovedIcon, ZapIcon, RepoIcon,
} from '@primer/octicons-react';
import { Card, CardHeader, MONO, LABEL } from '../../components';
import { HeroTile, CountBadge } from './shared';
import type { MinerProfile } from './types';

export interface CodeImpactCardProps {
  prAgg: { additions: number; deletions: number; uniqueRepos: number; total: number };
  miner: MinerProfile | undefined;
}

// Diff/lines summary for the current period plus a lifetime tally underneath.
// Shown in OSS mode only — the parent gates rendering by `mode`.
export function CodeImpactCard({ prAgg, miner }: CodeImpactCardProps) {
  const totalChanged = prAgg.additions + prAgg.deletions;
  const ratio = totalChanged > 0 ? (prAgg.additions / totalChanged) * 100 : 0;
  const addPct = Math.round(ratio);
  const delPct = 100 - addPct;
  const net = prAgg.additions - prAgg.deletions;
  const lifetimeAdded = miner?.totalAdditions ?? 0;
  const lifetimeDeleted = miner?.totalDeletions ?? 0;
  const lifetimeRepos = miner?.uniqueReposCount ?? 0;

  return (
    <Card>
      <CardHeader
        icon={<ZapIcon size={13} />}
        title="Code impact"
        sub={`${prAgg.uniqueRepos} repo${prAgg.uniqueRepos === 1 ? '' : 's'} · ${prAgg.total} PR${prAgg.total === 1 ? '' : 's'}`}
      />
      <Box sx={{ display: 'flex', alignItems: 'stretch', bg: 'canvas.default', borderBottom: '1px solid', borderColor: 'border.muted' }}>
        <HeroTile
          label="Added"
          value={`+${prAgg.additions.toLocaleString()}`}
          sub={totalChanged > 0 ? `${addPct}% of diff` : 'no changes'}
          tone="success"
        />
        <HeroTile
          label="Removed"
          value={`−${prAgg.deletions.toLocaleString()}`}
          sub={totalChanged > 0 ? `${delPct}% of diff` : '—'}
          tone="danger"
        />
        <HeroTile
          label="Net"
          value={`${net >= 0 ? '+' : '−'}${Math.abs(net).toLocaleString()}`}
          sub={net >= 0 ? 'more added' : 'more removed'}
          tone={net >= 0 ? 'success' : 'danger'}
        />
        <HeroTile
          label="Diff"
          value={
            totalChanged > 0
              ? <DiffSplit addPct={addPct} delPct={delPct} />
              : '—'
          }
          sub={totalChanged > 0 ? `${totalChanged.toLocaleString()} lines` : 'no changes'}
          last
        />
      </Box>
      <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
        <Text sx={{ ...LABEL }}>Lifetime</Text>
        <CountBadge icon={<DiffAddedIcon size={11} />}   value={lifetimeAdded.toLocaleString()}   label="added"   tone="success" />
        <CountBadge icon={<DiffRemovedIcon size={11} />} value={lifetimeDeleted.toLocaleString()} label="removed" tone="danger" />
        <CountBadge icon={<RepoIcon size={11} />}        value={lifetimeRepos}                    label="repos"   tone="accent" />
      </Box>
    </Card>
  );
}

function DiffSplit({ addPct, delPct }: { addPct: number; delPct: number }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: '100%',
        // Matches mono numeric height in adjacent tiles.
        height: '1.6em',
      }}
    >
      <Box sx={{ flex: 1, height: 8, borderRadius: 999, overflow: 'hidden', display: 'flex', bg: 'border.muted', minWidth: 0 }}>
        <Box style={{ width: `${addPct}%`, backgroundColor: 'var(--success-fg)' }} />
        <Box style={{ width: `${delPct}%`, backgroundColor: 'var(--danger-fg)' }} />
      </Box>
      <Box sx={{ display: 'inline-flex', gap: '4px', alignItems: 'baseline', flexShrink: 0 }}>
        <Text sx={{ ...MONO, fontSize: '11px', fontWeight: 700, color: 'success.fg' }}>+{addPct}%</Text>
        <Text sx={{ fontSize: '10px', color: 'fg.subtle' }}>/</Text>
        <Text sx={{ ...MONO, fontSize: '11px', fontWeight: 700, color: 'danger.fg' }}>−{delPct}%</Text>
      </Box>
    </Box>
  );
}
