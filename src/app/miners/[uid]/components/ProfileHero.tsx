'use client';

import React, { useMemo } from 'react';
import { Box, Heading, Text, Label } from '@primer/react';
import {
  StarIcon, StarFillIcon, MarkGithubIcon, KeyIcon, LinkExternalIcon, CopyIcon, CheckIcon,
  ClockIcon,
} from '@primer/octicons-react';
import { formatRelativeTime } from '@/lib/format';
import { EligibilityBadge, MONO, StatusBadge, STATUS_REGISTRY, MinerStatus } from '../../components';
import type { MinerProfile, PrDetail } from './types';

export interface ProfileHeroProps {
  ghName: string;
  ghAvatar: string;
  miner: MinerProfile | undefined;
  uid: string;
  isMe: boolean;
  isTracked: boolean;
  toggle: () => void;
  copied: boolean;
  onCopyHotkey: () => void;
  prs?: PrDetail[];
}

function deriveHeroStatus(miner: MinerProfile, prs: PrDetail[]): MinerStatus {
  const now = Date.now();
  const ms3d  = 3  * 86_400_000;
  const ms14d = 14 * 86_400_000;
  const recent3 = prs.filter(p => {
    const t = Date.parse(p.mergedAt ?? '');
    return p.prState === 'MERGED' && !isNaN(t) && now - t < ms3d;
  }).length;
  const recent14 = prs.filter(p => {
    const t = Date.parse(p.mergedAt ?? '');
    return p.prState === 'MERGED' && !isNaN(t) && now - t < ms14d;
  }).length;
  const merged      = miner.totalMergedPrs ?? 0;
  const uniqueRepos = miner.uniqueReposCount ?? 0;

  if (recent3 >= 3)  return { kind: 'hot',  ...STATUS_REGISTRY.hot };
  // climbing skipped — previousRank not available in detail profile
  if (recent14 === 0 && merged > 0) return { kind: 'dormant', ...STATUS_REGISTRY.dormant };
  if (uniqueRepos > 0 && uniqueRepos <= 2 && merged >= 5) return { kind: 'specialist', ...STATUS_REGISTRY.specialist };
  if (miner.isEligible && miner.isIssueEligible)          return { kind: 'dual',       ...STATUS_REGISTRY.dual };
  return { kind: 'none', icon: '', label: '', hint: '' };
}

export function ProfileHero({
  ghName, ghAvatar, miner, uid, isMe, isTracked, toggle, copied, onCopyHotkey, prs = [],
}: ProfileHeroProps) {
  const evaluatedAt = miner?.evaluatedAt;

  const status = useMemo<MinerStatus>(() => {
    if (!miner) return { kind: 'none', icon: '', label: '', hint: '' };
    return deriveHeroStatus(miner, prs);
  }, [miner, prs]);

  return (
    <Box
      sx={{
        px: [2, null, 3],
        py: ['10px', null, '12px'],
        display: 'flex',
        alignItems: 'center',
        gap: [2, null, 3],
        flexWrap: 'wrap',
      }}
    >
      <Box
        sx={{
          width: [40, null, 44],
          height: [40, null, 44],
          borderRadius: '50%',
          border: '1px solid',
          borderColor: 'border.default',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ghAvatar} alt={ghName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </Box>

      <Box sx={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {/* Row 1: name + UID + you + eligibility + status */}
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', minWidth: 0 }}>
          <Heading
            sx={{
              fontSize: [2, null, 3],
              letterSpacing: '-0.02em',
              color: 'fg.default',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 1.1,
            }}
          >
            {ghName}
          </Heading>
          <Text sx={{ ...MONO, fontSize: 0, color: 'fg.muted' }}>UID {miner?.uid ?? uid}</Text>
          {isMe && <Label variant="default" sx={{ fontSize: 0 }}>you</Label>}
          <EligibilityBadge eligible={!!miner?.isEligible}      label="OSS" />
          <EligibilityBadge eligible={!!miner?.isIssueEligible} label="DISC" />
          {status.kind !== 'none' && <StatusBadge status={status} />}
        </Box>

        {/* Row 2: hotkey + github + evaluated time */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minWidth: 0 }}>
          {miner?.hotkey && (
            <Box
              as="button"
              onClick={onCopyHotkey}
              aria-label="Copy hotkey"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                px: '8px',
                py: '3px',
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'border.muted',
                bg: 'canvas.inset',
                color: copied ? 'fg.default' : 'fg.muted',
                fontSize: 0,
                fontFamily: 'mono',
                cursor: 'pointer',
                maxWidth: 220,
                transition: 'border-color 100ms, color 100ms',
                '&:hover': { borderColor: 'border.default', color: 'fg.default' },
              }}
            >
              {copied ? <CheckIcon size={10} /> : <KeyIcon size={10} />}
              <Text sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={miner.hotkey}>
                {copied ? 'Copied' : `${miner.hotkey.slice(0, 8)}…${miner.hotkey.slice(-4)}`}
              </Text>
              <CopyIcon size={10} />
            </Box>
          )}
          {miner?.githubUsername && (
            <Box
              as="a"
              href={`https://github.com/${miner.githubUsername}`}
              target="_blank"
              rel="noreferrer"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                px: '8px',
                py: '3px',
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'border.muted',
                bg: 'canvas.inset',
                color: 'fg.muted',
                fontSize: 0,
                fontWeight: 600,
                textDecoration: 'none',
                transition: 'border-color 100ms, color 100ms',
                '&:hover': { borderColor: 'border.default', color: 'fg.default' },
              }}
            >
              <MarkGithubIcon size={10} /> GitHub <LinkExternalIcon size={9} />
            </Box>
          )}
          {evaluatedAt && (
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                color: 'fg.subtle',
                fontSize: '11px',
                ml: 'auto',
              }}
              title={`Evaluated at ${evaluatedAt}`}
            >
              <ClockIcon size={10} />
              <Text>evaluated {formatRelativeTime(evaluatedAt)}</Text>
            </Box>
          )}
        </Box>
      </Box>

      <Box
        as="button"
        onClick={toggle}
        aria-label={isTracked ? 'Untrack miner' : 'Track miner'}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          px: 3,
          py: '6px',
          border: '1px solid',
          borderColor: isTracked ? 'attention.emphasis' : 'border.default',
          borderRadius: 2,
          bg: isTracked ? 'attention.subtle' : 'canvas.default',
          color: isTracked ? 'attention.fg' : 'fg.default',
          fontWeight: 600,
          fontSize: 0,
          cursor: 'pointer',
          fontFamily: 'inherit',
          flexShrink: 0,
          transition: 'background-color 100ms, border-color 100ms, color 100ms',
          '&:hover': { bg: 'canvas.inset', borderColor: 'border.muted' },
        }}
      >
        {isTracked ? <StarFillIcon size={12} /> : <StarIcon size={12} />}
        {isTracked ? 'Tracked' : 'Track'}
      </Box>
    </Box>
  );
}
