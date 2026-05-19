'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import { Box, PageLayout, Heading, Text } from '@primer/react';
import IssuesTable from '@/components/IssuesTable';

const ISSUES_CONTENT_MAX_WIDTH = 1480;

export default function IssuesPage() {
  return (
    <PageLayout containerWidth="full" padding="normal">
      <PageLayout.Header>
        <Box sx={{ width: '100%', maxWidth: ISSUES_CONTENT_MAX_WIDTH, mx: 'auto' }}>
          <Heading sx={{ fontSize: 4, mb: 1 }}>Issues</Heading>
          <Text sx={{ color: 'fg.muted' }}>
            Live aggregated view across current SN74 and custom repositories. Star a repo to highlight its issues; toggle{' '}
            <strong>Tracked only</strong> to filter to your watchlist.
          </Text>
        </Box>
      </PageLayout.Header>
      <PageLayout.Content>
        <IssuesTable />
      </PageLayout.Content>
    </PageLayout>
  );
}
