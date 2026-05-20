// Shared primitives for the Miners pages.
import React from 'react';
import { Box, Text } from '@primer/react';
import { StarIcon, StarFillIcon, SearchIcon } from '@primer/octicons-react';

/* ─────────────────────────── Types ─────────────────────────── */

export interface Miner {
  id: string;
  uid: number;
  hotkey: string;
  githubUsername: string | null;
  githubId?: string;
  isEligible: boolean;
  isIssueEligible?: boolean;
  failedReason?: string | null;
  credibility: string;
  issueCredibility?: string;
  eligibleRepoCount?: number;
  issueEligibleRepoCount?: number;
  issueDiscoveryScore?: string;
  issueTokenScore?: string;
  totalScore: string;
  baseTotalScore?: string;
  totalSolvedIssues?: number;
  totalValidSolvedIssues?: number;
  totalOpenIssues?: number;
  totalClosedIssues?: number;
  totalOpenPrs?: number;
  totalClosedPrs?: number;
  totalMergedPrs?: number;
  // Server-enriched: merged PRs with tokenScore >= 5.
  totalValidMergedPrs?: number;
  // Server-enriched ISO timestamps.
  lastOssActivityAt?: string | null;
  lastDiscoveryActivityAt?: string | null;
  totalPrs?: number;
  totalAdditions?: number;
  totalDeletions?: number;
  uniqueReposCount?: number;
  alphaPerDay?: number;
  taoPerDay?: number;
  usdPerDay?: number;
}

export type Mode = 'total' | 'oss' | 'discovery';

export interface MinerView {
  mode: Mode;
  score: number;
  cred: number;
  eligible: boolean;
  usd: number;
  counts: {
    primaryLabel: 'Merged' | 'Solved' | 'Done';
    primary: number;
    open: number;
    closed: number;
  };
}

/* ─────────────────────────── Helpers ─────────────────────────── */

export function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

export function ghKey(name: string | null | undefined): string {
  return (name ?? '').toLowerCase();
}

export function ghName(m: Pick<Miner, 'githubUsername' | 'uid'>): string {
  return m.githubUsername || `uid-${m.uid}`;
}

export function ghAvatar(m: Pick<Miner, 'githubUsername' | 'uid'>, size: number): string {
  return `https://github.com/${ghName(m)}.png?size=${size}`;
}

export function splitEarnings(
  usdPerDay: number,
  ossScore: number,
  issueScore: number,
  ossEligible: boolean,
  issueEligible: boolean,
): { oss: number; disc: number } {
  const combined = ossScore + issueScore;
  let ossShare = 0, discShare = 0;
  if (ossEligible && issueEligible) {
    ossShare = combined > 0 ? ossScore / combined : 0.5;
    discShare = 1 - ossShare;
  } else if (ossEligible) {
    ossShare = 1;
  } else if (issueEligible) {
    discShare = 1;
  }
  return { oss: usdPerDay * ossShare, disc: usdPerDay * discShare };
}

// Mirrors per-repo Cred formula; upstream `credibility` uses a weighted
// formula that can disagree with the visible merge counts.
function acceptanceRate(positive: number, closed: number): number {
  const denom = positive + closed;
  return denom > 0 ? positive / denom : 0;
}

export function viewOf(m: Miner, mode: Mode): MinerView {
  const ossScore = num(m.totalScore);
  const issueScore = num(m.issueDiscoveryScore);
  const { oss: ossUsd, disc: discUsd } = splitEarnings(
    num(m.usdPerDay), ossScore, issueScore, !!m.isEligible, !!m.isIssueEligible,
  );

  const ossEligible = !!m.isEligible;
  const issueEligible = !!m.isIssueEligible;
  const combinedScore = ossScore + issueScore;

  const merged = m.totalMergedPrs ?? 0;
  const closedPr = m.totalClosedPrs ?? 0;
  const solved = m.totalSolvedIssues ?? 0;
  const closedIssue = m.totalClosedIssues ?? 0;
  const ossCred = acceptanceRate(merged, closedPr);
  const issueCred = acceptanceRate(solved, closedIssue);

  if (mode === 'discovery') {
    return {
      mode,
      score: issueScore,
      cred: issueCred,
      eligible: issueEligible,
      usd: discUsd,
      counts: {
        primaryLabel: 'Solved',
        primary: solved,
        open: m.totalOpenIssues ?? 0,
        closed: closedIssue,
      },
    };
  }
  if (mode === 'oss') {
    return {
      mode,
      score: ossScore,
      cred: ossCred,
      eligible: ossEligible,
      usd: ossUsd,
      counts: {
        primaryLabel: 'Merged',
        primary: merged,
        open: m.totalOpenPrs ?? 0,
        closed: closedPr,
      },
    };
  }
  const combinedCred = acceptanceRate(merged + solved, closedPr + closedIssue);
  return {
    mode,
    score: combinedScore,
    cred: combinedCred,
    eligible: ossEligible || issueEligible,
    usd: ossUsd + discUsd,
    counts: {
      primaryLabel: 'Done',
      primary: merged + solved,
      open: (m.totalOpenPrs ?? 0) + (m.totalOpenIssues ?? 0),
      closed: closedPr + closedIssue,
    },
  };
}

// Kept for API compatibility.
export function credColor(_v: number): string {
  return 'var(--fg-default)';
}

/* ─────────────────────────── Tokens ─────────────────────────── */

export const MONO = {
  fontFamily: 'mono',
  fontVariantNumeric: 'tabular-nums',
} as const;

export const LABEL = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.6px',
  textTransform: 'uppercase',
  color: 'fg.muted',
} as const;

/* ─────────────────────────── Avatar / Identity ─────────────────────────── */

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

export function MinerIdentity({
  miner,
  avatarSize,
  showUid = true,
}: {
  miner: Miner;
  isMe?: boolean;
  isTop?: boolean;
  tier?: unknown;
  avatarSize: number;
  showUid?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
      <MinerAvatar miner={miner} size={avatarSize} />
      <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: '6px' }}>
        <Text
          sx={{
            fontWeight: 600,
            fontSize: 1,
            color: 'fg.default',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            letterSpacing: '-0.005em',
          }}
        >
          {ghName(miner)}
        </Text>
        {showUid && (
          <Text sx={{ ...MONO, fontSize: '11px', color: 'fg.subtle', flexShrink: 0 }}>
            #{miner.uid}
          </Text>
        )}
      </Box>
    </Box>
  );
}

/* ─────────────────────────── Eligibility ─────────────────────────── */

export function EligibilityDot({ eligible, title }: { eligible: boolean; title?: string }) {
  return (
    <Box
      aria-hidden
      title={title ?? (eligible ? 'Eligible' : 'Not eligible')}
      sx={{
        width: 6,
        height: 6,
        borderRadius: 999,
        flexShrink: 0,
        bg: eligible ? 'success.fg' : 'transparent',
        border: eligible ? 'none' : '1px solid',
        borderColor: 'border.muted',
      }}
    />
  );
}

export function EligibilityBadge({
  eligible,
  label,
  size = 'sm',
}: {
  eligible: boolean;
  label: string;
  size?: 'sm' | 'md';
}) {
  const pad = size === 'md' ? { px: '8px', py: '3px', fz: '11px' } : { px: '6px', py: '2px', fz: '10px' };
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        px: pad.px,
        py: pad.py,
        borderRadius: 999,
        border: '1px solid',
        borderColor: eligible ? 'success.emphasis' : 'border.muted',
        bg: eligible ? 'success.subtle' : 'canvas.inset',
        color: eligible ? 'success.fg' : 'fg.muted',
        fontSize: pad.fz,
        fontWeight: 700,
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      <Box aria-hidden sx={{ width: 5, height: 5, borderRadius: 999, bg: eligible ? 'success.fg' : 'fg.subtle' }} />
      {label}
    </Box>
  );
}

/* ─────────────────────────── Track button ─────────────────────────── */

export function TrackButton({
  isTracked,
  onClick,
}: {
  isTracked: boolean;
  onClick: () => void;
}) {
  return (
    <Box
      as="button"
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        onClick();
      }}
      aria-label={isTracked ? 'Untrack miner' : 'Track miner'}
      title={isTracked ? 'Untrack miner' : 'Track miner'}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 26,
        bg: 'transparent',
        border: 'none',
        borderRadius: 1,
        color: isTracked ? 'fg.default' : 'fg.muted',
        cursor: 'pointer',
        '&:hover': { bg: 'canvas.inset', color: 'fg.default' },
      }}
    >
      {isTracked ? <StarFillIcon size={12} /> : <StarIcon size={12} />}
    </Box>
  );
}

/* ─────────────────────────── Card / Surface ─────────────────────────── */

export function Card({
  children,
  pad = false,
  inset = false,
}: {
  children: React.ReactNode;
  pad?: boolean;
  inset?: boolean;
}) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: inset ? 'canvas.inset' : 'canvas.subtle',
        overflow: 'hidden',
        p: pad ? 3 : 0,
      }}
    >
      {children}
    </Box>
  );
}

export function CardHeader({
  icon,
  title,
  sub,
  right,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        px: [2, null, 3],
        py: '8px',
        borderBottom: '1px solid',
        borderColor: 'border.muted',
        bg: 'canvas.default',
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap',
        minHeight: 38,
      }}
    >
      {icon && <Box sx={{ color: 'fg.muted', display: 'inline-flex' }}>{icon}</Box>}
      <Text sx={{ fontSize: 1, fontWeight: 700, letterSpacing: '-0.005em' }}>{title}</Text>
      {sub && (
        <Text sx={{ fontSize: 0, color: 'fg.muted' }}>· {sub}</Text>
      )}
      {right && <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>{right}</Box>}
    </Box>
  );
}

/* ─────────────────────────── Metric cell ─────────────────────────── */

export type Tone = 'neutral' | 'success' | 'danger' | 'done' | 'accent';

const TONE_FG: Record<Tone, string> = {
  neutral: 'var(--fg-default)',
  success: 'var(--success-fg)',
  danger:  'var(--danger-fg)',
  done:    'var(--done-fg)',
  accent:  'var(--accent-fg)',
};

export function Metric({
  label,
  value,
  sub,
  tone = 'neutral',
  size = 'md',
  align = 'left',
}: {
  label?: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  size?: 'sm' | 'md' | 'lg';
  align?: 'left' | 'right' | 'center';
}) {
  const valueSize = size === 'lg' ? [2, null, 3] : size === 'sm' ? 1 : 2;
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        textAlign: align,
        alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
        minWidth: 0,
      }}
    >
      {label && (
        <Text sx={{ ...LABEL }}>{label}</Text>
      )}
      <Text
        sx={{
          ...MONO,
          fontSize: valueSize,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
          color: 'fg.default',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
        }}
        style={{ color: TONE_FG[tone] }}
      >
        {value}
      </Text>
      {sub && (
        <Text sx={{ fontSize: '10px', color: 'fg.subtle', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
          {sub}
        </Text>
      )}
    </Box>
  );
}

/* ─────────────────────────── Intensity bar ─────────────────────────── */

export function IntensityBar({
  value,
  height = 4,
  tone = 'neutral',
  track = true,
}: {
  value: number;
  height?: number;
  tone?: Tone;
  track?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <Box
      sx={{
        width: '100%',
        height,
        borderRadius: 999,
        bg: track ? 'border.muted' : 'transparent',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <Box
        sx={{ height: '100%', borderRadius: 999, transition: 'width 240ms ease' }}
        style={{
          width: `${pct * 100}%`,
          backgroundColor: TONE_FG[tone],
          opacity: tone === 'neutral' ? 0.55 : 0.85,
        }}
      />
    </Box>
  );
}

export function SplitBar({
  a,
  b,
  height = 6,
  ariaLabel,
}: {
  a: number;
  b: number;
  height?: number;
  ariaLabel?: string;
}) {
  const total = a + b;
  const aPct = total > 0 ? (a / total) * 100 : 0;
  const bPct = total > 0 ? (b / total) * 100 : 0;
  return (
    <Box
      aria-label={ariaLabel}
      sx={{
        width: '100%',
        height,
        borderRadius: 999,
        bg: 'border.muted',
        overflow: 'hidden',
        display: 'flex',
      }}
    >
      <Box style={{ width: `${aPct}%`, backgroundColor: TONE_FG.accent, opacity: 0.85 }} />
      <Box style={{ width: `${bPct}%`, backgroundColor: TONE_FG.done, opacity: 0.85 }} />
    </Box>
  );
}

/* ─────────────────────────── Count cell ─────────────────────────── */

// Icon takes the tone color; value stays neutral so a column reads as one
// rhythm. Empty (0/—) dims both at reduced opacity.
export function CountCell({
  icon,
  value,
  tone = 'neutral',
  title,
}: {
  icon: React.ReactNode;
  value: number | string;
  tone?: Tone;
  title?: string;
}) {
  const empty = value === 0 || value === '—' || value === '0';
  return (
    <Box
      title={title}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '4px',
        minWidth: 0,
      }}
      style={{ opacity: empty ? 0.55 : 1 }}
    >
      <Box
        sx={{ display: 'inline-flex', flexShrink: 0 }}
        style={{ color: empty ? 'var(--fg-muted)' : TONE_FG[tone] }}
      >
        {icon}
      </Box>
      <Text
        sx={{
          ...MONO,
          fontSize: '11px',
          fontWeight: empty ? 400 : 600,
          lineHeight: 1,
          color: empty ? 'fg.muted' : 'fg.default',
        }}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </Text>
    </Box>
  );
}

/* ─────────────────────────── Pill / Chip ─────────────────────────── */

export function Pill({
  active,
  onClick,
  children,
  size = 'sm',
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  size?: 'sm' | 'md';
}) {
  const pad = size === 'md' ? { px: '12px', py: '5px', fz: 1 } : { px: '10px', py: '3px', fz: 0 };
  return (
    <Box
      as={onClick ? 'button' : 'span'}
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        px: pad.px,
        py: pad.py,
        border: '1px solid',
        borderColor: active ? 'border.default' : 'transparent',
        borderRadius: 999,
        bg: active ? 'canvas.default' : 'canvas.inset',
        color: active ? 'fg.default' : 'fg.muted',
        fontSize: pad.fz,
        fontWeight: active ? 700 : 500,
        cursor: onClick ? 'pointer' : 'default',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        textTransform: 'capitalize',
        transition: 'background-color 100ms, color 100ms',
        '&:focus': { outline: 'none' },
        '&:focus-visible': { outline: '1px solid var(--fg-default)', outlineOffset: '1px' },
        '&:hover': onClick ? { color: 'fg.default', bg: 'canvas.default' } : undefined,
      }}
    >
      {children}
    </Box>
  );
}

/* ─────────────────────────── Segmented control ─────────────────────────── */

export interface SegmentOption<K extends string> {
  key: K;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

export function Segmented<K extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegmentOption<K>[];
  value: K;
  onChange: (k: K) => void;
  ariaLabel?: string;
}) {
  return (
    <Box
      role="tablist"
      aria-label={ariaLabel}
      sx={{
        display: 'inline-flex',
        alignItems: 'stretch',
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'border.default',
        bg: 'canvas.inset',
        p: '3px',
      }}
    >
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <Box
            as="button"
            key={opt.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.key)}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
              px: '10px',
              py: '4px',
              border: 'none',
              borderRadius: 1,
              bg: active ? 'canvas.default' : 'transparent',
              color: active ? 'fg.default' : 'fg.muted',
              fontFamily: 'inherit',
              fontSize: 0,
              fontWeight: active ? 700 : 500,
              cursor: 'pointer',
              boxShadow: active ? '0 0 0 1px var(--border-default)' : 'none',
              transition: 'background-color 100ms, color 100ms',
              '&:focus': { outline: 'none' },
              '&:focus-visible': { outline: '1px solid var(--fg-default)', outlineOffset: '2px', borderRadius: '4px' },
              '&:hover': { color: 'fg.default' },
              whiteSpace: 'nowrap',
            }}
          >
            {opt.icon}
            {opt.label}
            {typeof opt.count === 'number' && (
              <Text
                sx={{
                  ...MONO,
                  fontSize: '10px',
                  fontWeight: 700,
                  color: active ? 'fg.muted' : 'fg.subtle',
                  px: '5px',
                  py: '1px',
                  borderRadius: 999,
                  bg: 'canvas.inset',
                }}
              >
                {opt.count.toLocaleString()}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/* ─────────────────────────── Search box ─────────────────────────── */

export function SearchBox({
  value,
  onChange,
  placeholder = 'Search…',
  size = 'sm',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  size?: 'sm' | 'md';
}) {
  const isMd = size === 'md';
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        px: 2,
        py: isMd ? '5px' : '4px',
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.default',
        color: 'fg.muted',
        minWidth: isMd ? 200 : 160,
        maxWidth: 320,
        flex: '1 1 auto',
        '&:focus-within': { borderColor: 'border.muted', color: 'fg.default' },
      }}
    >
      <SearchIcon size={12} />
      <Box
        as="input"
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        sx={{
          flex: 1,
          minWidth: 0,
          border: 'none',
          outline: 'none',
          bg: 'transparent',
          color: 'fg.default',
          fontFamily: 'inherit',
          fontSize: isMd ? 1 : 0,
          '&::placeholder': { color: 'fg.subtle' },
        }}
      />
      {value && (
        <Box
          as="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          sx={{
            border: 'none',
            bg: 'transparent',
            color: 'fg.subtle',
            cursor: 'pointer',
            fontSize: '10px',
            lineHeight: 1,
            px: 0,
            display: 'inline-flex',
            alignItems: 'center',
            '&:hover': { color: 'fg.default' },
          }}
        >
          ✕
        </Box>
      )}
    </Box>
  );
}

/* ─────────────────────────── Pagination ─────────────────────────── */

export function Pagination({
  page,
  pageCount,
  total,
  filtered,
  onPage,
  pageSize,
  zeroIndexed = false,
}: {
  page: number;
  pageCount: number;
  total: number;
  filtered: number;
  onPage: (p: number) => void;
  pageSize?: number;
  zeroIndexed?: boolean;
}) {
  if (total === 0) return null;
  const p1 = zeroIndexed ? page + 1 : page;
  const showRange = pageSize !== undefined;
  const start = showRange ? (p1 - 1) * (pageSize ?? 0) + 1 : 0;
  const end = showRange ? Math.min(p1 * (pageSize ?? 0), filtered) : 0;

  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
      {showRange && (
        <Text sx={{ ...MONO, fontSize: 0, color: 'fg.muted' }}>
          {start.toLocaleString()}–{end.toLocaleString()}
          <Text as="span" sx={{ color: 'fg.subtle' }}> / </Text>
          {filtered.toLocaleString()}
          {filtered !== total && (
            <Text as="span" sx={{ color: 'fg.subtle' }}> of {total.toLocaleString()}</Text>
          )}
        </Text>
      )}
      {!showRange && filtered !== total && (
        <Text sx={{ ...MONO, fontSize: 0, color: 'fg.muted' }}>
          {filtered.toLocaleString()} / {total.toLocaleString()}
        </Text>
      )}
      {pageCount > 1 && (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <NavBtn disabled={p1 <= 1} onClick={() => onPage(zeroIndexed ? page - 1 : page - 1)}>‹</NavBtn>
          <Text sx={{ ...MONO, fontSize: 0, minWidth: 44, textAlign: 'center', color: 'fg.muted' }}>
            <Text as="span" sx={{ color: 'fg.default', fontWeight: 700 }}>{p1}</Text>
            <Text as="span" sx={{ color: 'fg.subtle' }}> / </Text>
            {pageCount}
          </Text>
          <NavBtn disabled={p1 >= pageCount} onClick={() => onPage(zeroIndexed ? page + 1 : page + 1)}>›</NavBtn>
        </Box>
      )}
    </Box>
  );
}

function NavBtn({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Box
      as="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 1,
        bg: 'canvas.default',
        color: disabled ? 'fg.subtle' : 'fg.default',
        fontSize: 1,
        lineHeight: 1,
        fontFamily: 'inherit',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        '&:focus': { outline: 'none' },
        '&:focus-visible': { outline: '1px solid var(--fg-default)', outlineOffset: '1px' },
        '&:hover': disabled ? undefined : { bg: 'canvas.inset', borderColor: 'border.muted' },
      }}
    >
      {children}
    </Box>
  );
}

/* ─────────────────────────── Row-size selector ─────────────────────────── */

const CHEVRON_DOWN_URL =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 16 16' fill='%238b949e'><path d='M3.22 5.22a.75.75 0 0 1 1.06 0L8 8.94l3.72-3.72a.75.75 0 0 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 6.28a.75.75 0 0 1 0-1.06Z'/></svg>\")";

// `All` is encoded as `Infinity` so callers can use the value with `Array.slice(0, n)`.
export function RowSizeSelector({
  value,
  onChange,
  options = [10, 25, 50, 100],
  total,
  filtered,
  showAll = true,
  label = 'Rows',
}: {
  value: number;
  onChange: (n: number) => void;
  options?: number[];
  total?: number;
  filtered?: number;
  showAll?: boolean;
  label?: string;
}) {
  const showCount = typeof total === 'number' && typeof filtered === 'number';
  const visible = value === Infinity ? (filtered ?? 0) : Math.min(value, filtered ?? 0);
  const selectValue = value === Infinity ? 'all' : String(value);

  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
      {showCount && (
        <Text sx={{ ...MONO, fontSize: 0, color: 'fg.muted' }}>
          {visible.toLocaleString()}
          <Text as="span" sx={{ color: 'fg.subtle' }}>{' / '}</Text>
          {filtered!.toLocaleString()}
          {filtered !== total && (
            <Text as="span" sx={{ color: 'fg.subtle' }}>{` of ${total!.toLocaleString()}`}</Text>
          )}
        </Text>
      )}
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        <Text sx={{ ...LABEL, color: 'fg.muted', textTransform: 'none', fontWeight: 600, letterSpacing: 0 }}>
          {label}:
        </Text>
        <Box
          as="select"
          value={selectValue}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            const v = e.target.value;
            onChange(v === 'all' ? Infinity : Number.parseInt(v, 10));
          }}
          sx={{
            appearance: 'none',
            WebkitAppearance: 'none',
            MozAppearance: 'none',
            fontFamily: 'mono',
            fontVariantNumeric: 'tabular-nums',
            fontSize: 0,
            fontWeight: 700,
            lineHeight: 1,
            color: 'fg.default',
            bg: 'canvas.default',
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 1,
            pl: '8px',
            pr: '22px',
            py: '3px',
            height: 22,
            cursor: 'pointer',
            backgroundImage: CHEVRON_DOWN_URL,
            backgroundPosition: 'right 6px center',
            backgroundRepeat: 'no-repeat',
            transition: 'border-color 100ms',
            '&:focus': { outline: 'none' },
            '&:focus-visible': { outline: '1px solid var(--fg-default)', outlineOffset: '1px', borderColor: 'border.muted' },
            '&:hover': { borderColor: 'border.muted' },
          }}
        >
          {options.map((n) => (
            <option key={n} value={String(n)}>{n}</option>
          ))}
          {showAll && <option value="all">All</option>}
        </Box>
      </Box>
    </Box>
  );
}

/* ─────────────────────────── Page navigation ─────────────────────────── */

// Footer page-nav. `page` is 1-indexed; `pageSize === Infinity` is treated
// as a single page.
export function PageNav({
  page,
  pageSize,
  filteredCount,
  onPage,
}: {
  page: number;
  pageSize: number;
  filteredCount: number;
  onPage: (p: number) => void;
}) {
  if (filteredCount === 0) {
    return <Text sx={{ ...MONO, fontSize: 0, color: 'fg.muted' }}>0 of 0</Text>;
  }
  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));
  const safe = Math.min(Math.max(1, page), totalPages);
  const start = (safe - 1) * pageSize + 1;
  const end = Math.min(safe * pageSize, filteredCount);
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'fg.muted' }}>
      <Text sx={{ ...MONO, fontSize: 0 }}>
        {start.toLocaleString()}–{end.toLocaleString()}
        <Text as="span" sx={{ color: 'fg.subtle' }}>{' of '}</Text>
        {filteredCount.toLocaleString()}
      </Text>
      {totalPages > 1 && (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <PageBtn onClick={() => onPage(1)}             disabled={safe <= 1}          aria="First page">|‹</PageBtn>
          <PageBtn onClick={() => onPage(safe - 1)}      disabled={safe <= 1}          aria="Previous page">‹</PageBtn>
          <PageBtn onClick={() => onPage(safe + 1)}      disabled={safe >= totalPages} aria="Next page">›</PageBtn>
          <PageBtn onClick={() => onPage(totalPages)}    disabled={safe >= totalPages} aria="Last page">›|</PageBtn>
        </Box>
      )}
    </Box>
  );
}

function PageBtn({
  onClick,
  disabled,
  aria,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  aria: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      as="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={aria}
      title={aria}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 24,
        height: 24,
        px: 1,
        bg: 'transparent',
        border: '1px solid',
        borderColor: 'transparent',
        borderRadius: 1,
        color: disabled ? 'fg.subtle' : 'fg.muted',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        fontFamily: 'mono',
        fontSize: 0,
        lineHeight: 1,
        '&:focus': { outline: 'none' },
        '&:focus-visible': { outline: '1px solid var(--fg-default)', outlineOffset: '1px' },
        '&:hover': disabled ? undefined : { color: 'fg.default', bg: 'canvas.default', borderColor: 'border.muted' },
      }}
    >
      {children}
    </Box>
  );
}

/* ─────────────────────────── Empty state ─────────────────────────── */

export function EmptyState({
  icon,
  text,
  hint,
}: {
  icon?: React.ReactNode;
  text: string;
  hint?: string;
}) {
  return (
    <Box
      sx={{
        p: 4,
        textAlign: 'center',
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        bg: 'canvas.subtle',
        color: 'fg.muted',
      }}
    >
      {icon && <Box sx={{ display: 'inline-flex', justifyContent: 'center', mb: 2, color: 'fg.subtle' }}>{icon}</Box>}
      <Text sx={{ display: 'block', fontWeight: 600, fontSize: 1 }}>{text}</Text>
      {hint && (
        <Text sx={{ display: 'block', fontSize: 0, color: 'fg.subtle', mt: 1, maxWidth: 420, mx: 'auto' }}>
          {hint}
        </Text>
      )}
    </Box>
  );
}

/* ─────────────────────────── Dot separator ─────────────────────────── */

export function Sep() {
  return <Text aria-hidden sx={{ color: 'fg.subtle' }}>·</Text>;
}
