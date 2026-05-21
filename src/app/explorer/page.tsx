'use client';

export const dynamic = 'force-dynamic';

import React, { Suspense } from 'react';
import RepoExplorer from '@/components/RepoExplorer';

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <RepoExplorer />
    </Suspense>
  );
}
