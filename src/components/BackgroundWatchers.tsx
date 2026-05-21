'use client';

import { usePathname } from 'next/navigation';
import NewIssuesWatcher from './NewIssuesWatcher';

// Pre-auth routes where the polling widgets would just rack up 401s.
const NO_POLL_ROUTES = new Set(['/sign-in']);

export default function BackgroundWatchers() {
  const pathname = usePathname();
  if (NO_POLL_ROUTES.has(pathname)) return null;

  return (
    <>
      <NewIssuesWatcher />
    </>
  );
}
