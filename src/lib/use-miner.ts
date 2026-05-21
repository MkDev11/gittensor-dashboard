'use client';

import { useSession } from '@/lib/settings';

/**
 * Returns the GitHub login of the user currently signed into the dashboard
 * (via the GitHub OAuth flow). Used everywhere we mark a row as "yours" —
 * the Pull Requests "My PRs only" filter, the "you" badge on `/miners`, etc.
 *
 * Used to return the *operator's* PAT login. Now scoped to the OAuth session
 * so each signed-in user sees their own data.
 */
export function useMinerLogin(): string {
  const { username } = useSession();
  return username ?? '';
}
