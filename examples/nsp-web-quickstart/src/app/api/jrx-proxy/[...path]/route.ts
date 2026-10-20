/**
 * Catch-all reverse proxy from /api/jrx-proxy/* → ${JRX_BASE_URL}/api/jrx/* (or full path).
 *
 * - Injects server-only `JRX_API_KEY` as Bearer + X-API-Key.
 * - Forwards method, allow-listed headers, query string, and body.
 * - Streams upstream responses (SSE / NDJSON).
 */

import { NextRequest } from 'next/server';

const JRX_BASE_URL = process.env.NEXT_PUBLIC_JRX_BASE_URL ?? 'https://jurexio.nyayasiddhi.online';
const JRX_API_KEY = process.env.JRX_API_KEY;

const SAFE_REQUEST_HEADERS = ['content-type', 'accept', 'x-jrx-correlation-id', 'x-jrx-platform', 'x-jrx-jurisdiction'];

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function proxy(req: NextRequest, ctx: { params: { path?: string[] } }) {
  if (!JRX_API_KEY) {
    return new Response(JSON.stringify({ error: 'JRX_API_KEY missing on server' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
  const path = (ctx.params.path ?? []).join('/');
  const url = new URL(`${JRX_BASE_URL.replace(/\/$/, '')}/${path}`);
  for (const [k, v] of req.nextUrl.searchParams) url.searchParams.append(k, v);

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${JRX_API_KEY}`);
  headers.set('X-API-Key', JRX_API_KEY);
  for (const h of SAFE_REQUEST_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const init: RequestInit = {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
  };
  const upstream = await fetch(url.toString(), init);

  const forwardedHeaders = new Headers(upstream.headers);
  forwardedHeaders.delete('content-encoding');
  forwardedHeaders.delete('content-length');
  forwardedHeaders.delete('transfer-encoding');

  return new Response(upstream.body, {
    status: upstream.status,
    headers: forwardedHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
