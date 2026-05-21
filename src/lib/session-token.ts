// Edge-runtime-safe cookie verification. Uses Web Crypto only (no node:crypto, no fs).
// The session secret comes from SESSION_SECRET in env — populated at first
// server start by lib/auth.ts (which has Node access to write .env.local).

export const SESSION_COOKIE_NAME = 'gittensor_session';
export const SESSION_MAX_AGE_SEC = 30 * 24 * 3600;

export type SessionStatus = 'pending' | 'approved' | 'rejected';

export interface SessionPayload {
  uid: number;
  // GitHub login. Kept under the `username` key for backward-compat with the
  // existing useSession() hook and consumers that read session.username.
  username: string;
  status: SessionStatus;
  is_admin: boolean;
  avatar_url?: string | null;
  exp: number;
}

// Cache the imported HMAC key, but key it by the current secret string so that
// rotating SESSION_SECRET (e.g. when auth.ts generates one on first start)
// invalidates the cache rather than silently using the old key.
let _cached: { secret: string; key: Promise<CryptoKey> } | null = null;
function getKey(): Promise<CryptoKey> {
  // Fail closed when SESSION_SECRET is missing or empty. A hardcoded fallback
  // would let anyone who knows the string forge admin session tokens.
  const secretStr = process.env.SESSION_SECRET;
  if (!secretStr) throw new Error('SESSION_SECRET is required');
  if (_cached && _cached.secret === secretStr) return _cached.key;
  const key = crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretStr),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  _cached = { secret: secretStr, key };
  return key;
}

function bufToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBuf(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sign(payload: string): Promise<string> {
  const key = await getKey();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return bufToBase64Url(sig);
}

export async function encodeSession(p: SessionPayload): Promise<string> {
  const body = bufToBase64Url(new TextEncoder().encode(JSON.stringify(p)).buffer as ArrayBuffer);
  const sig = await sign(body);
  return `${body}.${sig}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected: string;
  try {
    expected = await sign(body);
  } catch {
    return null;
  }
  if (sig.length !== expected.length) return null;
  // Constant-time compare
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const json = JSON.parse(new TextDecoder().decode(base64UrlToBuf(body))) as SessionPayload;
    if (typeof json.uid !== 'number' || typeof json.username !== 'string' || typeof json.exp !== 'number') {
      return null;
    }
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch {
    return null;
  }
}
