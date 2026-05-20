import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { setSessionCookieFor, upsertGithubUser } from '@/lib/auth';
import { publicOrigin } from '@/lib/origin';
import { safeOAuthNextPath } from '@/lib/oauth-next';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'gh_oauth_state';
const NEXT_COOKIE = 'gh_oauth_next';

interface GhTokenResp {
  access_token?: string;
  error?: string;
  error_description?: string;
}
interface GhUser {
  id: number;
  login: string;
  avatar_url: string | null;
}

function err(req: NextRequest, code: string): NextResponse {
  const url = new URL('/sign-in', publicOrigin(req));
  url.searchParams.set('error', code);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return err(req, 'oauth_not_configured');

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  if (!code || !state) return err(req, 'missing_code_or_state');

  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value;
  // Re-check the cookie in case it was hand-set or came from an older build.
  const next = safeOAuthNextPath(jar.get(NEXT_COOKIE)?.value);
  // Clear the one-shot cookies regardless of outcome.
  jar.set({ name: STATE_COOKIE, value: '', maxAge: 0, path: '/' });
  jar.set({ name: NEXT_COOKIE, value: '', maxAge: 0, path: '/' });
  if (!expectedState || expectedState !== state) return err(req, 'state_mismatch');

  // Exchange code → access token.
  let tok: GhTokenResp;
  try {
    const r = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: new URL('/api/auth/github/callback', publicOrigin(req)).toString(),
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    tok = (await r.json()) as GhTokenResp;
  } catch {
    return err(req, 'token_exchange_failed');
  }
  if (!tok.access_token) return err(req, tok.error || 'no_token');

  // Fetch the authenticated user.
  let user: GhUser;
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tok.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'gittensor-miner-dashboard',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return err(req, `user_fetch_${r.status}`);
    user = (await r.json()) as GhUser;
  } catch {
    return err(req, 'user_fetch_failed');
  }
  if (!user.id || !user.login) return err(req, 'invalid_user_payload');

  const row = upsertGithubUser({
    github_id: String(user.id),
    github_login: user.login,
    avatar_url: user.avatar_url,
  });
  // Rejected users (admin-banned) don't get a session, just bounce back to
  // sign-in with an error so they can't quietly retry.
  const origin = publicOrigin(req);
  if (row.status === 'rejected') {
    const url = new URL('/sign-in', origin);
    url.searchParams.set('error', 'account_rejected');
    return NextResponse.redirect(url);
  }

  await setSessionCookieFor(row);
  return NextResponse.redirect(new URL(next, origin));
}
