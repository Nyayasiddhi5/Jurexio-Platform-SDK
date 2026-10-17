// UAT-44: Exercises the REAL in-process webhook delivery path.
//
// Imports `handleWebhookDelivery` and `signWebhookBody` from the gateway's
// `src/services/queue/webhook-dispatcher.ts` and invokes them directly via
// tsx — no parallel/duplicated signing logic in this script.
//
// Positive case  → delegates to handleWebhookDelivery() (real body assembly,
//                  real HMAC, real fetch call to the receiver).
// Negative cases → tampered signature + stale timestamp are constructed with
//                  the *imported* signWebhookBody() helper so they share the
//                  exact format the receiver verifies.
//
// Run: NYV_WEBHOOK_ALLOW_PRIVATE=true tsx scripts/uat-fire-webhook.mjs

import { handleWebhookDelivery, signWebhookBody } from '../src/services/queue/webhook-dispatcher.ts';

const URL_TARGET = process.env.UAT_WEBHOOK_URL || 'http://localhost:3000/api/nyv-webhook';
const SECRET     = process.env.NYV_WEBHOOK_SECRET || 'test_webhook_secret_uat44_aa11bb22cc33dd44';

if (process.env.NYV_WEBHOOK_ALLOW_PRIVATE !== 'true') {
  console.error('Set NYV_WEBHOOK_ALLOW_PRIVATE=true (localhost target).');
  process.exit(2);
}

// ── 1. Valid signature: real in-process dispatcher path ──────────────────────
const correlationId = 'NYV-UAT44-' + Date.now();
const positiveJob = {
  appId: 'app_42',
  platform: 'nsp',
  url: URL_TARGET,
  event: 'orchestration.completed',
  secret: SECRET,
  correlationId,
  payload: {
    orchestrationId: 'orc_uat44_' + Date.now(),
    summary: 'UAT-44 synthetic completion — verifies webhook receiver HMAC verification.',
    tokens: { input: 120, output: 380, total: 500 },
    cost: 0.0042,
    metadata: { agentsUsed: ['legal-research', 'contract-review'], model: 'gpt-4.1-2025-04-14' },
  },
};

let validStatus;
try {
  const r = await handleWebhookDelivery(positiveJob);
  validStatus = r.status;
  console.log(`[valid signature  ] HTTP ${validStatus} (via handleWebhookDelivery)`);
} catch (err) {
  console.error('[valid signature  ] FAILED', err);
  process.exit(2);
}

// ── 2. Tampered signature ────────────────────────────────────────────────────
async function fireRaw({ tamperBody = false, tsOverride = null, label }) {
  const ts = tsOverride ?? new Date().toISOString();
  const body = JSON.stringify({
    event: 'orchestration.completed',
    appId: 'app_42',
    platform: 'nsp',
    correlationId,
    payload: positiveJob.payload,
    ts,
  });
  // Sign over (possibly) DIFFERENT bytes so verification fails downstream.
  const sig = signWebhookBody(tamperBody ? body + '#' : body, SECRET, ts);
  const res = await fetch(URL_TARGET, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Nyayavigya-Webhook/5.0.0',
      'X-NYV-Event': 'orchestration.completed',
      'X-NYV-Platform': 'nsp',
      'X-NYV-Timestamp': ts,
      'X-NYV-Signature': sig,
      'X-NYV-Correlation-Id': correlationId,
    },
    body,
    redirect: 'manual',
  });
  const txt = await res.text();
  console.log(`[${label}] HTTP ${res.status} → ${txt.slice(0, 160)}`);
  return res.status;
}

const tamperedStatus = await fireRaw({ tamperBody: true,  label: 'tampered signature' });
const staleStatus    = await fireRaw({ tsOverride: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
                                       label: 'stale timestamp ' });

const ok = validStatus === 200 && tamperedStatus === 401 && staleStatus === 400;
if (!ok) {
  console.error(`UAT WEBHOOK FAILED — valid=${validStatus} tampered=${tamperedStatus} stale=${staleStatus}`);
  process.exit(2);
}
console.log(`UAT WEBHOOK PASSED — valid=${validStatus} tampered=${tamperedStatus} stale=${staleStatus}`);
