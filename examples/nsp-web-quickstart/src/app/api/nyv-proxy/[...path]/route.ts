/**
 * Catch-all reverse proxy from /api/jrx-proxy/* → ${JRX_BASE_URL}/*.
 *
 * - Injects the server-only `JRX_API_KEY` as a Bearer token.
 * - Forwards method, headers (allow-listed), query string, and body.
 * - Streams the response back to the browser so SSE / NDJSON keeps working.
 *
 * Why a proxy: the live API key is a long-lived secret. Shipping it to the
 * browser would let any visitor exhaust the org's quota. The proxy keeps the
 * key server-side and forwards only what the user is allowed to hit.
 */

import { NextRequest } from 'next/server';

const JRX_BASE_URL = process.env.NEXT_PUBLIC_JRX_BASE_URL ?? 'https://api.jurexio.com';
const JRX_API_KEY  = process.env.JRX_API_KEY;

const SAFE_REQUEST_HEADERS = ['content-type', 'accept', 'x-jrx-correlation-id', 'x-jrx-platform', 'x-jrx-jurisdiction'];

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function proxy(req: NextRequest, ctx: { params: { path?: string[] } }) {
  if (!JRX_API_KEY) {
    return new Response(JSON.stringify({ error: 'JRX_API_KEY missing on server' }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }
  const path = (ctx.params.path ?? []).join('/');
  const url = new URL(`${JRX_BASE_URL.replace(/\/$/, '')}/${path}`);
  // Forward query string verbatim.
  for (const [k, v] of req.nextUrl.searchParams) url.searchParams.append(k, v);

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${JRX_API_KEY}`);
  for (const h of SAFE_REQUEST_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  // Materialise the body into an ArrayBuffer before forwarding. Streaming via
  // `req.body` + `duplex: 'half'` works in next build/start but is rejected by
  // the dev server's pages-router fallback on Next.js 14.2 (returns 405 from
  // /_error). Buffering is safe here because gateway requests are JSON / small
  // multipart payloads — not large file uploads.
  const init: RequestInit = {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
  };
  const upstream = await fetch(url.toString(), init);

  // Strip transport-encoding headers: undici has already transparently
  // decompressed the upstream body, but if we forward `content-encoding: gzip`
  // and `content-length`, the browser/client will try to decompress raw bytes
  // and fail (NV-NSP-FIX-006).
  const forwardedHeaders = new Headers(upstream.headers);
  forwardedHeaders.delete('content-encoding');
  forwardedHeaders.delete('content-length');
  forwardedHeaders.delete('transfer-encoding');

  // Stream the upstream response straight through (works for SSE + JSON).
  return new Response(upstream.body, {
    status: upstream.status,
    headers: forwardedHeaders,
  });
}

export const GET     = proxy;
export const POST    = proxy;
export const PUT     = proxy;
export const PATCH   = proxy;
export const DELETE  = proxy;
export const OPTIONS = proxy;
