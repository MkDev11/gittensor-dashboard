'use client';

import React from 'react';
import { Box, Heading, Text, Label } from '@primer/react';
import {
  StarIcon, StarFillIcon, MarkGithubIcon, KeyIcon, LinkExternalIcon, CopyIcon, CheckIcon,
} from '@primer/octicons-react';
import { EligibilityBadge, MONO } from '../../components';
import type { MinerProfile } from './types';

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
}

// Header card: avatar + name + UID + eligibility chips + hotkey copy + track
// toggle, in one wrap-friendly row.
export function ProfileHero({
  ghName, ghAvatar, miner, uid, isMe, isTracked, toggle, copied, onCopyHotkey,
}: ProfileHeroProps) {
  return (
    <Box
      sx={{
        mt: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap',
        p: 2,
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
      }}
    >
      <Box
        sx={{
          width: [40, null, 48],
          height: [40, null, 48],
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

      <Box sx={{ flex: '1 1 220px', minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap' }}>
          <Heading
            sx={{
              fontSize: [2, null, 3],
              letterSpacing: '-0.02em',
              color: 'fg.default',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {ghName}
          </Heading>
          <Text sx={{ ...MONO, fontSize: 0, color: 'fg.muted' }}>UID {miner?.uid ?? uid}</Text>
          {isMe && <Label variant="default" sx={{ fontSize: 0 }}>you</Label>}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mt: '4px', flexWrap: 'wrap' }}>
          <EligibilityBadge eligible={!!miner?.isEligible}      label="OSS" />
          <EligibilityBadge eligible={!!miner?.isIssueEligible} label="DISC" />
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
                '&:hover': { borderColor: 'border.default', color: 'fg.default' },
              }}
            >
              <MarkGithubIcon size={10} /> GitHub <LinkExternalIcon size={9} />
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
          borderColor: 'border.default',
          borderRadius: 2,
          bg: isTracked ? 'canvas.inset' : 'canvas.default',
          color: 'fg.default',
          fontWeight: 600,
          fontSize: 0,
          cursor: 'pointer',
          fontFamily: 'inherit',
          flexShrink: 0,
          transition: 'background-color 100ms, border-color 100ms',
          '&:hover': { bg: 'canvas.inset', borderColor: 'border.muted' },
        }}
      >
        {isTracked ? <StarFillIcon size={12} /> : <StarIcon size={12} />}
        {isTracked ? 'Tracked' : 'Track'}
      </Box>
    </Box>
  );
}
