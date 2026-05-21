'use client';

import React from 'react';
import type { Miner } from './types';
import { ghAvatar, ghName } from './helpers';

// Small circular GitHub avatar. Reused by Spotlights and by LeaderTable's
// internal MinerIdentity. Sized via the `size` prop (CSS pixels).
export function MinerAvatar({
  miner,
  size,
}: {
  miner: Pick<Miner, 'githubUsername' | 'uid'>;
  size: number;
}) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={ghAvatar(miner, size * 2)}
      alt={ghName(miner)}
      loading="lazy"
      style={{
        width: size,
        height: size,
        boxSizing: 'border-box',
        borderRadius: '50%',
        border: '1px solid var(--border-muted)',
        flexShrink: 0,
      }}
    />
  );
}
