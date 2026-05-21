const SAFE_NEXT_ORIGIN = 'https://gittensor.local';

export function safeOAuthNextPath(rawNext: string | null | undefined): string {
  const next = rawNext || '/';
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';

  try {
    if (new URL(next, SAFE_NEXT_ORIGIN).origin !== SAFE_NEXT_ORIGIN) return '/';
  } catch {
    return '/';
  }

  return next;
}
