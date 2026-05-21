import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MINERS_URL = 'https://api.gittensor.io/miners';
const TTL_MS = 30_000;

const NETUID = 74;
const NETWORK = 'finney';
const SUBNET_NAME = 'Gittensor';
const CONTRACT_ADDRESS = '5FWNdk8YNtNcHKrAx2krqenFrFAZG7vmsd2XN2isJSew3MrD';
const OSS_EMISSION_SHARE = 0.9;
const ISSUES_TREASURY_EMISSION_SHARE = 0.1;

interface MinerRow {
  isEligible?: boolean;
  isIssueEligible?: boolean;
  alphaPerDay?: number;
  taoPerDay?: number;
  usdPerDay?: number;
}

interface Snapshot {
  fetched_at: number;
  netuid: number;
  network: string;
  subnetName: string;
  contractAddress: string;
  emission: {
    scoringShare: number;
    issueTreasuryShare: number;
  };
  miners: {
    total: number;
    prEligible: number;
    issueEligible: number;
  };
  daily: {
    alpha: number;
    tao: number;
    usd: number;
  };
  rates: {
    alphaTao: number;
    alphaUsd: number;
    taoUsd: number;
  };
}

let cache: Snapshot | null = null;
let inFlight: Promise<Snapshot> | null = null;

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : 0;
  return Number.isFinite(n) ? n : 0;
}

async function refresh(): Promise<Snapshot> {
  const r = await fetch(MINERS_URL, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error('upstream miners ' + r.status);
  const miners = (await r.json()) as MinerRow[];

  let alpha = 0;
  let tao = 0;
  let usd = 0;
  for (const miner of miners) {
    const a = num(miner.alphaPerDay);
    const t = num(miner.taoPerDay);
    const u = num(miner.usdPerDay);
    alpha += a;
    tao += t;
    usd += u;
  }

  const next: Snapshot = {
    fetched_at: Date.now(),
    netuid: NETUID,
    network: NETWORK,
    subnetName: SUBNET_NAME,
    contractAddress: CONTRACT_ADDRESS,
    emission: {
      scoringShare: OSS_EMISSION_SHARE,
      issueTreasuryShare: ISSUES_TREASURY_EMISSION_SHARE,
    },
    miners: {
      total: miners.length,
      prEligible: miners.filter((m) => m.isEligible).length,
      issueEligible: miners.filter((m) => m.isIssueEligible).length,
    },
    daily: { alpha, tao, usd },
    rates: {
      alphaTao: alpha > 0 ? tao / alpha : 0,
      alphaUsd: alpha > 0 ? usd / alpha : 0,
      taoUsd: tao > 0 ? usd / tao : 0,
    },
  };
  cache = next;
  return next;
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.fetched_at < TTL_MS) return NextResponse.json({ ...cache, source: 'cache' });
  if (!inFlight) {
    inFlight = refresh().finally(() => {
      inFlight = null;
    });
  }
  try {
    const fresh = await inFlight;
    return NextResponse.json({ ...fresh, source: 'live' });
  } catch (err) {
    if (cache) return NextResponse.json({ ...cache, source: 'stale', error: String(err) });
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
