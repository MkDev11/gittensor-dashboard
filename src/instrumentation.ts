export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Generate / persist SESSION_SECRET first so the middleware bundle (Edge)
    // and the route bundles (Node) see the same value from startup.
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
      const fs = await import('fs');
      const path = await import('path');
      const { randomBytes } = await import('crypto');
      const envPath = path.resolve(process.cwd(), '.env.local');
      const body = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      const m = body.match(/^SESSION_SECRET=(.*)$/m);
      if (m) {
        process.env.SESSION_SECRET = m[1].trim();
      } else {
        const secret = randomBytes(48).toString('base64url');
        const next = (body && !body.endsWith('\n') ? body + '\n' : body) + `SESSION_SECRET=${secret}\n`;
        try {
          fs.writeFileSync(envPath, next, { mode: 0o600 });
        } catch (err) {
          console.warn('[instrumentation] could not persist SESSION_SECRET:', err);
        }
        process.env.SESSION_SECRET = secret;
        console.log('[instrumentation] generated SESSION_SECRET and wrote it to .env.local');
      }
    }

    // Poller is back on with two safeguards: tier-1 and tier-2 now share a
    // single "cycleRunning" flag so they never overlap, and every GitHub
    // fetch is wrapped in a 30s AbortController timeout so a hung upstream
    // can't stall the event loop. Set POLLER_ENABLED=0 to disable for emergencies.
    if (process.env.POLLER_ENABLED !== '0') {
      const { startPoller } = await import('@/lib/poller');
      startPoller();
      setTimeout(() => {
        void (async () => {
          try {
            const { runClosingBackfillSweep } = await import('@/lib/refresh');
            await runClosingBackfillSweep();
          } catch (err) {
            console.warn('[instrumentation] closing-backfill sweep failed:', err);
          }
        })();
      }, 30_000).unref?.();
    } else {
      console.log('[instrumentation] poller disabled by POLLER_ENABLED=0');
    }
  }
}
