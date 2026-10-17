'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { NyvClient } from '@nyayavigya/client-sdk';

/**
 * Single shared NyvClient instance.
 *
 * IMPORTANT — security note: in this quickstart we read NEXT_PUBLIC_NYV_BASE_URL
 * from the browser. We do NOT expose the API key to the browser. Every API call
 * goes through a /api/* route handler in this Next.js app, which holds the
 * server-side `NYV_API_KEY`.
 *
 * If you absolutely must call the gateway from the browser, mint a short-lived
 * scoped token via the console's `/sdk/tokens/exchange` endpoint instead of
 * shipping the long-lived sk_live key.
 */

interface NyvCtx {
  baseUrl: string;
  client: NyvClient;
}

const Ctx = createContext<NyvCtx | null>(null);

export function NyvProvider({ children }: { children: ReactNode }) {
  const value = useMemo<NyvCtx>(() => {
    const baseUrl = process.env.NEXT_PUBLIC_NYV_BASE_URL ?? 'https://api.nyayasiddhi.online';
    // Browser-side client uses a stub key; real key stays on the server.
    const client = new NyvClient({
      apiKey: 'nyv_live_sk_browser_proxied',
      baseUrl: '/api/nyv-proxy', // intercepted by route handlers in src/app/api/nyv-proxy/[...path]/route.ts
    });
    return { baseUrl, client };
  }, []);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNyv(): NyvCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useNyv: must be used inside <NyvProvider>');
  return v;
}
