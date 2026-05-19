const RECENT_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

export function isRecent(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < RECENT_THRESHOLD_MS;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export interface UsdFormatOptions {
  /**
   * 'adaptive' (default): ≥100 → 0 digits, ≥1 → 2 digits, <1 → 4 digits.
   * Use for variable-magnitude values like miner earnings.
   *
   * 'price': ≥1 → 2 digits, <1 → 4 digits.
   * Use for market prices that always show cents.
   *
   * 'compact': ≥1 → 2 digits but trims a trailing `.00` so whole
   * dollars read cleanly ($212, $79.06). <1 → 4 digits like 'price'.
   */
  style?: 'adaptive' | 'price' | 'compact';
  /** Returned for 0 or non-finite values. Default '$0'. */
  fallback?: string;
}

export function formatUsd(n: number, opts: UsdFormatOptions = {}): string {
  const { style = 'adaptive', fallback = '$0' } = opts;
  if (!n || !Number.isFinite(n)) return fallback;
  const abs = Math.abs(n);
  if (style === 'price') {
    return abs >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
  }
  if (style === 'compact') {
    if (abs >= 1) {
      const fixed = n.toFixed(2);
      return fixed.endsWith('.00') ? `$${fixed.slice(0, -3)}` : `$${fixed}`;
    }
    return `$${n.toFixed(4)}`;
  }
  if (abs >= 100) return `$${n.toFixed(0)}`;
  if (abs >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

/** Projected monthly USD from a daily rate (~$X/mo). */
export function formatUsdMonthly(daily: number): string {
  if (!Number.isFinite(daily)) return '~$0/mo';
  return `~$${(daily * 30).toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo`;
}

export interface TaoFormatOptions {
  /** Returned for 0 or non-finite values. Default '—'. */
  fallback?: string;
}

export function formatTao(n: number, opts: TaoFormatOptions = {}): string {
  const { fallback = '—' } = opts;
  if (!n || !Number.isFinite(n)) return fallback;
  return Math.abs(n) >= 1 ? `${n.toFixed(3)}τ` : `${n.toFixed(6)}τ`;
}

export interface NumberFormatOptions {
  /** Decimal places for |value| < 1000. Default 2. */
  digits?: number;
  /** Returned for 0 or non-finite values. Default '-'. */
  fallback?: string;
}

/** Adaptive number formatting: |value| ≥ 1000 is integer, otherwise `digits` precision. */
export function formatNumber(n: number, opts: NumberFormatOptions = {}): string {
  const { digits = 2, fallback = '-' } = opts;
  if (!Number.isFinite(n) || n === 0) return fallback;
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  return n.toFixed(digits);
}

export interface CountFormatOptions {
  /** Returned for 0 or non-finite values. Default '-'. */
  fallback?: string;
}

/** Integer count with locale grouping (1,234). */
export function formatCount(n: number, opts: CountFormatOptions = {}): string {
  const { fallback = '-' } = opts;
  if (!n || !Number.isFinite(n)) return fallback;
  return n.toLocaleString();
}

export interface PercentFormatOptions {
  /** Multiplier (use 100 when the input is a 0..1 ratio). Default 1. */
  scale?: number;
  /** Decimal places. Default 0. */
  digits?: number;
  /** Prefix '+' for positive values. Default false. */
  signed?: boolean;
  /** Returned for 0 or non-finite values. Default '0%'. */
  fallback?: string;
}

export function formatPercent(
  value: number | string | null | undefined,
  opts: PercentFormatOptions = {},
): string {
  const { scale = 1, digits = 0, signed = false, fallback = '0%' } = opts;
  const raw = typeof value === 'string' ? parseFloat(value) : value;
  if (raw == null || !Number.isFinite(raw) || raw === 0) return fallback;
  const n = raw * scale;
  const sign = signed && n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}
