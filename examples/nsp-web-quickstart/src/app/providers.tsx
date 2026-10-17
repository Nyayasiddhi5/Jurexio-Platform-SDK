'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { JrxClient } from '@nyayavigya/client-sdk';

/**
 * Single shared JrxClient instance.
 *
 * IMPORTANT — security note: in this quickstart we read NEXT_PUBLIC_JRX_BASE_URL
 * from the browser. We do NOT expose the API key to the browser. Every API call
 * goes through a /api/* route handler in this Next.js app, which holds the
 * server-side `JRX_API_KEY`.
 *
 * If you absolutely must call the gateway from the browser, mint a short-lived
 * scoped token via the console's `/sdk/tokens/exchange` endpoint instead of
 * shipping the long-lived sk_live key.
 */

interface JrxCtx {
  baseUrl: string;
  client: JrxClient;
}

const Ctx = createContext<JrxCtx | null>(null);

export function JrxProvider({ children }: { children: ReactNode }) {
  const value = useMemo<JrxCtx>(() => {
    const baseUrl = process.env.NEXT_PUBLIC_JRX_BASE_URL ?? 'https://api.jurexio.com';
    // Browser-side client uses a stub key; real key stays on the server.
    const client = new JrxClient({
      apiKey: 'nyv_live_sk_browser_proxied',
      baseUrl: '/api/jrx-proxy', // intercepted by route handlers in src/app/api/jrx-proxy/[...path]/route.ts
    });
    return { baseUrl, client };
  }, []);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useJrx(): JrxCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useJrx: must be used inside <JrxProvider>');
  return v;
}
