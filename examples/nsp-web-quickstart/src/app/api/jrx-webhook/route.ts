/**
 * Webhook receiver for `orchestration.completed` events.
 *
 * Verifies the `X-JRX-Signature: sha256=…` header by computing
 * HMAC-SHA-256(secret, `${timestamp}.${body}`) and comparing in
 * constant time. Rejects payloads older than 5 minutes (replay window).
 */

import { NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest) {
  const secret = process.env.JRX_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: 'JRX_WEBHOOK_SECRET not configured' }, { status: 500 });
  }
  const sig = req.headers.get('x-jrx-signature') ?? '';
  const ts = req.headers.get('x-jrx-timestamp') ?? '';
  if (!sig || !ts) return Response.json({ error: 'missing sig/ts headers' }, { status: 400 });

  const tsMs = ts.includes('-') || ts.includes('T') ? Date.parse(ts) : Number(ts);
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > FIVE_MINUTES_MS) {
    return Response.json({ error: 'stale timestamp' }, { status: 400 });
  }

  const body = await req.text();
  const expected = 'sha256=' + createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ error: 'invalid signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = { raw: body };
  }

  const event = (payload as { event?: string })?.event;

  if (event === 'orchestration.completed') {
    console.log('[jrx-webhook] orchestration.completed:', {
      appId: (payload as { appId?: string })?.appId,
      orchestrationId: (payload as { payload?: { orchestrationId?: string } })?.payload?.orchestrationId,
    });
  } else {
    console.log('[jrx-webhook] event:', event);
  }

  return Response.json({ ok: true });
}
