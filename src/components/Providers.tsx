'use client';

import React, { useState } from 'react';
import { ThemeProvider, BaseStyles } from '@primer/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/lib/toast';
import { useTheme } from '@/lib/theme';
import { linearTheme } from '@/lib/linear-theme';

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            staleTime: 500,
          },
        },
      })
  );
  const { theme } = useTheme();

  return (
    <ThemeProvider theme={linearTheme} colorMode={theme === 'dark' ? 'night' : 'day'} preventSSRMismatch>
      {/* Force BaseStyles' page bg/fg to the CSS vars (set pre-paint by the
       * inline theme script in layout.tsx) instead of Primer's theme colors.
       * Otherwise, during SSR + the first client render the React color-mode
       * hasn't synced yet (defaults to dark), so BaseStyles paints a dark
       * background over the correct light body for a few hundred ms. */}
      <BaseStyles style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--fg-default)' }}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      </BaseStyles>
    </ThemeProvider>
  );
}
