// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * SDK Webhook Listener — fires `orchestration.completed` deliveries.
 *
 * Two trigger pathways, both go through the same `dispatchWebhook` (BullMQ
 * durable, retried, DLQ-backed):
 *
 *  1. Queen orchestrator event hook — when `queenOrchestrator` emits
 *     `orchestration_complete` and the result carries an `applicationId`,
 *     we deliver the completion to that app's webhook URL.
 *
 *  2. Direct trigger — `fireOrchestrationCompletedWebhook(appId, payload)` is
 *     exported for the SDK gateway middleware to call after a successful 2xx
 *     completion-style response (agent execute / document analyze / document
 *     draft). This is the reliable path that does not depend on the orchestra-
 *     tor being on the call path.
 *
 * Tenants configure their `webhookUrl` + `webhookSecret` via the SDK console
 * (POST /api/jrx/sdk/console/apps/:id). SSRF + URL validation happens inside
 * `dispatchWebhook` — we just pass through.
 *
 * Trigger contract (for SDK consumers)
 *   Header `X-JRX-Event: orchestration.completed`
 *   Header `X-JRX-Signature: sha256=<hex>` over `${ts}.${body}`
 *   Header `X-JRX-Timestamp: <iso>`
 *   Body  { event, appId, platform, correlationId, payload, ts }
 */

import { db as _raw_db } from '../../db/index.js';
import { lazyRequire } from '../../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sdkApplications } from '@shared/schema.js';
import { eq } from 'drizzle-orm';
import { queenOrchestrator } from '../../orchestration/jrx-queen-orchestrator.js';
import { dispatchWebhook } from '../queue/webhook-dispatcher.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('sdk-webhook-listener');

let _started = false;

/* ── tiny TTL cache so we don't hit Postgres on every completion ──────────── */
interface AppWebhook {
  id: number;
  appType: string;
  appName: string;
  webhookUrl: string;
  webhookSecret: string;
  organizationId: number;
}
const APP_CACHE = new Map<number, { v: AppWebhook | null; expires: number }>();
const APP_CACHE_TTL_MS = 60_000;

async function getAppWebhookConfig(appId: number): Promise<AppWebhook | null> {
  const cached = APP_CACHE.get(appId);
  if (cached && cached.expires > Date.now()) return cached.v;

  try {
    const [app] = await db
      .select({
        id: sdkApplications.id,
        appType: sdkApplications.appType,
        appName: sdkApplications.appName,
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        webhookUrl: sdkApplications.webhookUrl,
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        webhookSecret: sdkApplications.webhookSecret,
        organizationId: sdkApplications.organizationId,
      })
      .from(sdkApplications)
      .where(eq(sdkApplications.id, appId))
      .limit(1);

    const value: AppWebhook | null =
      app && app.webhookUrl && app.webhookSecret
        ? (app as AppWebhook)
        : null;

    APP_CACHE.set(appId, { v: value, expires: Date.now() + APP_CACHE_TTL_MS });
    return value;
  } catch (err) {
    logger.warn('webhook config lookup failed', {
      appId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/* ── public API ───────────────────────────────────────────────────────────── */

export function startSdkWebhookListener(): void {
  if (_started) return;
  _started = true;

  queenOrchestrator.on('orchestration_complete', (result: any) => {
    const appId: number | undefined =
      result?.metadata?.applicationId ??
      result?.metadata?.appId ??
      result?.applicationId ??
      result?.appId;

    if (!appId || typeof appId !== 'number') {
      // Internal back-fill / non-SDK runs do not trigger webhooks.
      return;
    }

    fireOrchestrationCompletedWebhook(appId, {
      orchestrationId:
        result?.orchestrationId ??
        result?.metadata?.orchestrationId ??
        result?.traceId ??
        null,
      summary: typeof result?.synthesizedOutput === 'string'
        ? result.synthesizedOutput.slice(0, 1024)
        : (result?.synthesizedOutput?.summary ?? null),
      metadata: result?.metadata ?? null,
    }).catch(() => { /* logged inside */ });
  });

  logger.info('SDK webhook listener installed (orchestration.completed)');
}

export interface OrchestrationCompletedPayload {
  /** Trace / orchestration id from the completion. */
  orchestrationId?: string | null;
  /** Endpoint that produced the completion (eg `/agents/contract-review/execute`). */
  endpoint?: string;
  /** Optional short text summary (≤ 1 KB). */
  summary?: string | null;
  /** Tokens used in the completion. */
  tokens?: { input?: number; output?: number; total?: number } | null;
  /** Cost (USD) of the completion. */
  cost?: number | null;
  /** Full metadata blob (latency, model, agentsUsed…). */
  metadata?: Record<string, unknown> | null;
}

/**
 * Direct-trigger entry point. Looks up the app's webhook config (cached for
 * 60 s) and enqueues a signed delivery via BullMQ. Safe to call from
 * `res.on('finish')` — never throws, never blocks.
 */
export async function fireOrchestrationCompletedWebhook(
  appId: number,
  payload: OrchestrationCompletedPayload,
): Promise<void> {
  try {
    const cfg = await getAppWebhookConfig(appId);
    if (!cfg) return; // tenant has not configured a webhook

    await dispatchWebhook({
      appId: String(cfg.id),
      platform: cfg.appType ?? 'custom',
      url: cfg.webhookUrl,
      event: 'orchestration.completed',
      secret: cfg.webhookSecret,
      correlationId: String(payload.orchestrationId ?? ''),
      payload: {
        ...payload,
        appId: cfg.id,
        appName: cfg.appName,
        organizationId: cfg.organizationId,
        completedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.warn('orchestration.completed enqueue failed', {
      appId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Test-only — drops the cache so configuration changes propagate immediately. */
export function _resetWebhookCache(): void {
  APP_CACHE.clear();
}
