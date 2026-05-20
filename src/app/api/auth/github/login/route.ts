import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { publicOrigin } from '@/lib/origin';
import { safeOAuthNextPath } from '@/lib/oauth-next';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'gh_oauth_state';
const NEXT_COOKIE = 'gh_oauth_next';
const STATE_MAX_AGE_SEC = 600; // 10 min — plenty for the round-trip

export async function GET(req: NextRequest) {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'GITHUB_OAUTH_CLIENT_ID not set' }, { status: 500 });
  }
  const state = randomBytes(24).toString('base64url');
  const next = safeOAuthNextPath(req.nextUrl.searchParams.get('next'));

  // GitHub authorization callback URL must match the one registered on the
  // OAuth App. We derive it from the public-facing host header (not from
  // req.nextUrl.origin, which Next.js dev rewrites to localhost).
  const callback = new URL('/api/auth/github/callback', publicOrigin(req)).toString();

  const auth = new URL('https://github.com/login/oauth/authorize');
  auth.searchParams.set('client_id', clientId);
  auth.searchParams.set('redirect_uri', callback);
  auth.searchParams.set('scope', 'read:user');
  auth.searchParams.set('state', state);
  auth.searchParams.set('allow_signup', 'true');

  const jar = await cookies();
  const cookieOpts = {
    httpOnly: true,
    sameSite: 'lax' as const,
    // Tied to the actual request scheme — Secure cookies aren't sent over
    // plain HTTP, so the callback would lose the state cookie and fail.
    secure: publicOrigin(req).startsWith('https://'),
    path: '/',
    maxAge: STATE_MAX_AGE_SEC,
  };
  jar.set({ name: STATE_COOKIE, value: state, ...cookieOpts });
  jar.set({ name: NEXT_COOKIE, value: next, ...cookieOpts });

  return NextResponse.redirect(auth.toString());
}
