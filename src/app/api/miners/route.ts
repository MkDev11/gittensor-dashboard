import { NextResponse } from 'next/server';
import type { Miner, MinersResponse } from '@/types/entities';

export const dynamic = 'force-dynamic';

const URL = 'https://api.gittensor.io/miners';
// Tight cache so the page's 10 s polling sees fresh upstream data; in-flight
// dedup still ensures multiple clients don't multiply upstream requests.
const TTL_MS = 5_000;

interface Cached {
  fetched_at: number;
  miners: Miner[];
}

let cache: Cached | null = null;
let inFlight: Promise<Cached> | null = null;

async function refresh(): Promise<Cached> {
  const r = await fetch(URL, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const miners = (await r.json()) as Miner[];
  const next: Cached = { fetched_at: Date.now(), miners };
  cache = next;
  return next;
}

function payload(c: Cached, source: 'live' | 'cache' | 'stale', error?: string): MinersResponse & { error?: string } {
  return {
    count: c.miners.length,
    fetched_at: c.fetched_at,
    source,
    miners: c.miners,
    ...(error ? { error } : {}),
  };
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.fetched_at < TTL_MS) {
    return NextResponse.json(payload(cache, 'cache'));
  }
  if (!inFlight) {
    inFlight = refresh().finally(() => {
      inFlight = null;
    });
  }
  try {
    const fresh = await inFlight;
    return NextResponse.json(payload(fresh, 'live'));
  } catch (err) {
    if (cache) {
      return NextResponse.json(payload(cache, 'stale', String(err)));
    }
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
