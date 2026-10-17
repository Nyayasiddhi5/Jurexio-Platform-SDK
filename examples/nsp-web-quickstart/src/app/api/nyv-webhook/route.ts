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
  const ts  = req.headers.get('x-jrx-timestamp') ?? '';
  if (!sig || !ts) return Response.json({ error: 'missing sig/ts headers' }, { status: 400 });

  // Replay protection. The platform dispatcher sends an ISO-8601 timestamp
  // (e.g. "2026-04-25T03:41:06.828Z"); older builds may have sent epoch
  // milliseconds. Accept either format.
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

  let payload: any;
  try { payload = JSON.parse(body); } catch { payload = { raw: body }; }

  const event = payload?.event as string | undefined;

  if (event === 'orchestration.completed') {
    // eslint-disable-next-line no-console
    console.log('[jrx-webhook] orchestration.completed:', {
      appId: payload?.appId,
      orchestrationId: payload?.payload?.orchestrationId,
    });
  } else if (event === 'document.job.completed' || event === 'document.job.failed') {
    // eslint-disable-next-line no-console
    console.log(`[jrx-webhook] ${event}:`, {
      jobId: payload?.payload?.jobId,
      correlationId: payload?.payload?.correlationId,
      callbackMetadata: payload?.payload?.callbackMetadata,
      status: payload?.payload?.status ?? payload?.payload?.error?.code,
    });
    // TODO: Update your ns_documents row using callbackMetadata.nspDocumentId
  } else if (event === 'document.job.progress') {
    // eslint-disable-next-line no-console
    console.log('[jrx-webhook] document.job.progress:', {
      jobId: payload?.payload?.jobId,
      phase: payload?.payload?.phase,
      progress: payload?.payload?.progress,
    });
  } else {
    // eslint-disable-next-line no-console
    console.log('[jrx-webhook] unknown event:', event, payload);
  }

  return Response.json({ ok: true });
}
