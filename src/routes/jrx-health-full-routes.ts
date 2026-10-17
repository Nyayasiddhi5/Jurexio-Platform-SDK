/**
 * NV SDK — Full Platform Health Aggregator v3.0
 * GET /health/full  — parallel health checks across all sub-services and platforms
 * GET /health/ready — Kubernetes-style readiness probe (fails on P0 issues)
 * GET /health/live  — Kubernetes-style liveness probe
 *
 * v3.0 Additions (T005):
 *   - checkPaymentGateway: Razorpay key presence + validation
 *   - checkWhatsApp: WhatsApp Business API token + phone ID presence
 *   - checkErrorTracking: Sentry DSN presence + environment verification
 *   - setup_required flag with actionable instructions for each missing integration
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db/index.js';
import { listBreakers, getBreakerStats } from '../services/circuit-breaker.js';
import { isQueueEnabled, isQueueLive, getQueueHealth, getQueueDisabledReason } from '../services/queue/bullmq-queue.js';
import { realLLMService, getLlmProviderBreakerSnapshot } from '../services/real-llm-service.js';
import { getSpanLatencies, getTaggedSpanLatencies, getTracerStatus } from '../utils/nyv-tracer.js';
import { getRedisDisabledReason, resolveRedisTcpUrl } from '../utils/redis-tcp-url.js';
import { getCircuitBreakerMetrics } from '../utils/jrx-circuit-breaker.js';
import { getRequestMetricsSnapshot } from '../middleware/nyv-request-metrics.js';
import { getRagRetrievalStats } from '../services/rag-service.js';
import { getAutoRagStats } from '../services/jrx-auto-rag-router.js';
import { lmCacheService } from '../services/lm-cache-service.js';
import { nvRedisCache } from '../services/jrx-redis-cache-service.js';
import { getRegistryStats } from '../services/agent-registry-service.js';
import { NYV_PLATFORM_VERSION } from '../config/nyv-master-config.js';
import { resolveNysPlaneHealth } from '../utils/jrx-nys-plane-health.js';

const router = Router();

interface ServiceCheck {
  // 'not_configured' (NV-HEALTH-002, 2026-05-09): optional integration whose
  // env-var was never provisioned. Excluded from `overallStatus` rollup so
  // optional-integration absence does not yellow-flag the platform.
  status: 'healthy' | 'degraded' | 'unhealthy' | 'not_configured';
  latencyMs?: number;
  details?: any;
  setup_required?: boolean;
  setup_instructions?: string;
}

/**
 * Pool null-guard — `pool` from `db/index.ts` is `AnyPool | null` because
 * it lazy-initialises on first DB connect. The five health-check call
 * sites in this file pre-date the null-typed export and were silently
 * casting (TS18047). Mirror the `requireDb()` pattern from
 * `services/social-memory-service.ts` so we surface a clear error
 * instead of a TypeError at runtime when the pool isn't ready yet.
 */
function requirePool(): NonNullable<typeof pool> {
  if (!pool) {
    throw new Error('database pool not initialised');
  }
  return pool;
}

/* ── Database ────────────────────────────────────────────── */
async function checkDatabase(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    await requirePool().query('SELECT 1');
    return { status: 'healthy', latencyMs: Date.now() - start };
  } catch (e: any) {
    return { status: 'unhealthy', latencyMs: Date.now() - start, details: e.message };
  }
}

/* ── Redis ───────────────────────────────────────────────── */
async function checkRedis(): Promise<ServiceCheck> {
  const start = Date.now();

  // NV-SECRETS-001 (2026-05-07): single resolver source of truth.
  const _r = resolveRedisTcpUrl();
  const tcpUrl = _r.enabled && _r.url ? _r.url : '';
  // REST surface is intentionally separate from TCP (Upstash REST is a
  // different protocol the resolver rejects); /admin/health/full still
  // reports it for visibility.
  const restRaw = process.env.REDIS_URL || process.env.NYV_REDIS_URL || '';
  const restUrl = restRaw.trim().replace(/^["']+|["']+$/g, '');

  // Strategy 1: ioredis TCP
  if (tcpUrl && (tcpUrl.startsWith('rediss://') || tcpUrl.startsWith('redis://'))) {
    let client: any = null;
    try {
      const { Redis } = await import('ioredis');
      client = new Redis(tcpUrl, {
        lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 0,
        reconnectOnError: () => false, enableReadyCheck: false, retryStrategy: () => null,
      });
      // NYV-OPS-HEALTH-REDIS-AUTH-001 (Task #28 round 4): attach `error`
      // BEFORE connect(). Without this, when WRONGPASS comes back ioredis
      // emits an "error" event that has no listener and surfaces as
      // "[ioredis] Unhandled error event" — once per /admin/health/full
      // request. The .catch on connect() lands too late to suppress it.
      client.on('error', () => { /* swallow — handled via reject below */ });
      await client.connect();
      const pong = await Promise.race([
        client.ping(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]);
      await client.quit().catch(() => {});
      if (pong === 'PONG') return { status: 'healthy', latencyMs: Date.now() - start, details: { mode: 'ioredis_tcp' } };
    } catch (e: any) {
      // Fall through to REST strategy. Ensure the socket is closed so we
      // don't leak a half-open auth-failed connection between requests.
      try { client?.disconnect(); } catch { /* ignore */ }
    }
  }

  // Strategy 2: Upstash REST (https://)
  if (restUrl && restUrl.startsWith('https://')) {
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.NYV_UPSTASH_REST_TOKEN || '';
    if (token) {
      try {
        const { Redis: UpstashRedis } = await import('@upstash/redis');
        const rc = new UpstashRedis({ url: restUrl, token });
        await rc.ping();
        return { status: 'healthy', latencyMs: Date.now() - start, details: { mode: 'upstash_rest', readWrite: true } };
      } catch (e: any) {
        return { status: 'degraded', latencyMs: Date.now() - start, details: `Upstash REST ping failed: ${e.message}` };
      }
    } else {
      return {
        status: 'degraded', latencyMs: Date.now() - start,
        setup_required: true,
        setup_instructions: 'Set UPSTASH_REDIS_REST_TOKEN to your Upstash REST token (visible in Upstash console → Databases → REST API tab). Current REDIS_URL is the Upstash REST URL but the token is missing.',
        details: { mode: 'upstash_rest', readWrite: false, missingEnv: 'UPSTASH_REDIS_REST_TOKEN' },
      };
    }
  }

  if (!tcpUrl && !restUrl) {
    return {
      status: 'degraded',
      setup_required: true,
      setup_instructions: 'Set NYV_REDIS_TCP_URL to a rediss:// Upstash TCP URL or REDIS_URL+UPSTASH_REDIS_REST_TOKEN for REST access.',
      details: 'No Redis URL configured',
    };
  }

  return { status: 'degraded', latencyMs: Date.now() - start, details: 'Redis unreachable' };
}

/* ── LLM Provider ────────────────────────────────────────── */
async function checkLLM(): Promise<ServiceCheck> {
  const hasOpenAI     = !!process.env.OPENAI_API_KEY;
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
  if (!hasOpenAI && !hasOpenRouter) {
    return {
      status: 'degraded',
      setup_required: true,
      setup_instructions: 'Set OPENROUTER_API_KEY (recommended — multi-model routing) or OPENAI_API_KEY in environment secrets.',
      details: 'No LLM API key configured',
    };
  }
  const provider = hasOpenAI ? 'OpenAI' : 'OpenRouter';
  // NYV-OPS-LLM-LOCKDOWN-001 (Task #28): surface the active provider lockdown
  // so operators can confirm at a glance which providers the gateway will
  // accept (post-T8b: anthropic/openai/google/openrouter/sarvam).
  let allowedProviders: string[] = [];
  let voiceModels: string[] = [];
  try {
    const { ALLOWED_PROVIDERS, OPENAI_VOICE_MODELS } = await import('../config/nyv-allowed-providers.js');
    allowedProviders = [...ALLOWED_PROVIDERS];
    voiceModels = [...OPENAI_VOICE_MODELS];
  } catch {
    // config not loadable — leave arrays empty so the surface still renders
  }
  return {
    status: 'healthy',
    details: {
      provider,
      model: 'gpt-4.1',
      fallbackAvailable: hasOpenAI && hasOpenRouter,
      allowedProviders,
      voiceModels,
      lockdownActive: allowedProviders.length > 0,
    },
  };
}

/* ── Agent Registry ──────────────────────────────────────── */
async function checkAgentRegistry(): Promise<ServiceCheck> {
  try {
    const stats = getRegistryStats();
    return {
      status: stats.totalAgents > 0 ? 'healthy' : 'degraded',
      details: {
        agentsLoaded: stats.totalAgents,
        practiceAreas: stats.practiceAreas,
        registryFormat: stats.registryFormat,
        registryVersion: stats.registryVersion,
        section23Coverage: stats.section23Coverage,
        jurisdictions: stats.byJurisdiction,
      },
    };
  } catch (e: any) {
    return { status: 'degraded', details: `Registry unavailable: ${e.message}` };
  }
}

/* ── Platform health sub-check ───────────────────────────── */
async function checkPlatform(name: string, url: string): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    const latencyMs = Date.now() - start;
    return res.ok
      ? { status: 'healthy', latencyMs }
      : { status: 'degraded', latencyMs, details: `HTTP ${res.status}` };
  } catch {
    return { status: 'degraded', latencyMs: Date.now() - start, details: 'unreachable' };
  }
}

/* ── JWT Secret Strength ─────────────────────────────────── */
function checkJwtSecret(): ServiceCheck {
  const secret = process.env.JWT_SECRET || process.env.NS_JWT_SECRET;
  if (!secret) return {
    status: 'degraded',
    setup_required: true,
    setup_instructions: 'Set JWT_SECRET to a cryptographically secure random string of at least 64 characters.',
    details: 'JWT_SECRET not set — using insecure default',
  };
  if (secret.length < 64) return { status: 'degraded', details: `JWT_SECRET too short (${secret.length}/64 chars minimum)` };
  const setDateStr = process.env.JWT_SECRET_SET_DATE;
  if (setDateStr) {
    const setDate = new Date(setDateStr);
    const daysSinceRotation = Math.floor((Date.now() - setDate.getTime()) / 86_400_000);
    if (daysSinceRotation > 90) {
      return { status: 'degraded', details: `JWT_SECRET is ${daysSinceRotation} days old — rotate within 90 days` };
    }
    return { status: 'healthy', details: { length: secret.length, daysSinceRotation, nextRotationIn: `${90 - daysSinceRotation} days` } };
  }
  return { status: 'healthy', details: { length: secret.length, rotationTracking: 'Set JWT_SECRET_SET_DATE env var to track rotation age' } };
}

/* ── Payment Gateway (Razorpay) ──────────────────────────── */
function checkPaymentGateway(): ServiceCheck {
  const keyId     = process.env.NYV_RAZORPAY_KEY_ID     || process.env.RAZORPAY_KEY_ID     || '';
  const keySecret = process.env.NYV_RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET || '';

  if (!keyId || !keySecret) {
    // NV-HEALTH-002: payments are downstream-product concern (NSP-billing);
    // platform gateway has no /api/jrx/payments dependency. Mark not_configured
    // so optional-integration absence doesn't degrade overall status.
    return {
      status: 'not_configured',
      setup_required: true,
      setup_instructions: [
        '1. Create a Razorpay account at https://razorpay.com',
        '2. Go to Settings → API Keys → Generate Test/Live Key',
        '3. Add to environment: NYV_RAZORPAY_KEY_ID=rzp_test_... and NYV_RAZORPAY_KEY_SECRET=<secret>',
        '4. Payments route (/api/jrx/payments/*) will become active immediately.',
      ].join('\n'),
      details: {
        provider: 'Razorpay',
        hasKeyId: !!keyId,
        hasKeySecret: !!keySecret,
        missingEnvVars: [...(!keyId ? ['NYV_RAZORPAY_KEY_ID'] : []), ...(!keySecret ? ['NYV_RAZORPAY_KEY_SECRET'] : [])],
      },
    };
  }

  const isLive = keyId.startsWith('rzp_live_');
  const isTest = keyId.startsWith('rzp_test_');
  return {
    status: 'healthy',
    details: {
      provider: 'Razorpay',
      mode: isLive ? 'live' : isTest ? 'test' : 'unknown',
      keyIdPrefix: keyId.slice(0, 12) + '...',
    },
  };
}

/* ── WhatsApp Business API ───────────────────────────────── */
function checkWhatsApp(): ServiceCheck {
  const token   = process.env.NYV_WHATSAPP_TOKEN    || process.env.WHATSAPP_ACCESS_TOKEN || '';
  const phoneId = process.env.NYV_WHATSAPP_PHONE_ID || process.env.WHATSAPP_PHONE_ID     || '';

  if (!token || !phoneId) {
    // NV-HEALTH-002: WhatsApp is an optional notification channel; absence is
    // informational, not a degradation of the platform.
    return {
      status: 'not_configured',
      setup_required: true,
      setup_instructions: [
        '1. Create a Meta Developer App at https://developers.facebook.com',
        '2. Add WhatsApp Business product → Get a permanent system access token',
        '3. Add your phone number to WhatsApp Business account and get the phone ID',
        '4. Set: NYV_WHATSAPP_TOKEN=<access_token> and NYV_WHATSAPP_PHONE_ID=<phone_number_id>',
        '5. WhatsApp notifications (/api/jrx/whatsapp/*) will become active immediately.',
      ].join('\n'),
      details: {
        provider: 'WhatsApp Business API (Meta)',
        hasToken: !!token,
        hasPhoneId: !!phoneId,
        missingEnvVars: [...(!token ? ['NYV_WHATSAPP_TOKEN'] : []), ...(!phoneId ? ['NYV_WHATSAPP_PHONE_ID'] : [])],
      },
    };
  }

  return {
    status: 'healthy',
    details: {
      provider: 'WhatsApp Business API (Meta)',
      phoneId: phoneId.slice(0, 6) + '...',
      tokenConfigured: true,
    },
  };
}

/* ── Error Tracking (Sentry) ─────────────────────────────── */
function checkErrorTracking(): ServiceCheck {
  const dsn = process.env.NYV_SENTRY_DSN || process.env.SENTRY_DSN || '';
  const env  = process.env.NODE_ENV || 'development';

  if (!dsn) {
    // NV-HEALTH-002: Sentry is an optional observability sink; absence is
    // informational, not a degradation of the platform.
    return {
      status: 'not_configured',
      setup_required: true,
      setup_instructions: [
        '1. Create a Sentry project at https://sentry.io — select Node.js + React',
        '2. Copy the DSN from Settings → Client Keys (DSN)',
        '3. Add to environment: NYV_SENTRY_DSN=https://...@sentry.io/...',
        '4. Sentry will auto-capture errors, performance, and session replay.',
      ].join('\n'),
      details: {
        provider: 'Sentry',
        environment: env,
        missingEnvVars: ['NYV_SENTRY_DSN'],
      },
    };
  }

  const isValidDsn = dsn.startsWith('https://') && dsn.includes('@sentry.io/');
  return {
    status: isValidDsn ? 'healthy' : 'degraded',
    details: {
      provider: 'Sentry',
      environment: env,
      dsnConfigured: true,
      dsnValid: isValidDsn,
      dsnPreview: dsn.replace(/https:\/\/([^@]+)@/, 'https://***@'),
    },
  };
}

/* ═══════════════════════════════════════════════════════════
   GET /health/full  — Full platform health aggregator
══════════════════════════════════════════════════════════ */
router.get('/', async (req: Request, res: Response) => {
  const startAll = Date.now();
  const registryStats = getRegistryStats();
  // NYV-OBS-PUBLIC-REDACT-001 (Task #28 round 9): the same router is
  // mounted at two paths — `/api/jrx/health/full` (public, no auth, used
  // by liveness/readiness probes and the public status page) and
  // `/api/jrx/admin/health/full` (gated by authenticateToken +
  // requireAdmin, used by the operator dashboard). The admin payload
  // contains breaker internals, queue depths, per-provider LLM health,
  // tracer span/tag latencies, RAG/memory/HITL detail, request metrics,
  // and dashboard URLs — none of which should leak to anonymous
  // callers (information disclosure → maps internal architecture and
  // capacity to attackers). We branch on req.baseUrl so the public
  // path returns a minimal liveness-safe view (overall status +
  // service-level UP/DOWN only) and the admin path returns the full
  // operator surface.
  const isAdmin = req.baseUrl.includes('/admin/');

  // NV-HEALTH-002 (2026-05-09): nsp_api/nsi_api are downstream platforms that
  // do NOT run on the gateway VM. Only probe when the env URL is explicitly
  // set; otherwise return `not_configured` (informational, does not flip
  // overallStatus). Same applies to Razorpay/Sentry/WhatsApp checks below.
  const NSP_URL = process.env.NSP_API_URL;
  const NSI_URL = process.env.NSI_API_URL;
  const [dbCheck, redisCheck, llmCheck, agentsCheck, nspApiCheck, nsiApiCheck, nysPlaneCheck] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkLLM(),
    checkAgentRegistry(),
    NSP_URL ? checkPlatform('nsp_api', NSP_URL) : Promise.resolve({ status: 'not_configured', details: 'NSP_API_URL not set; downstream platform not deployed on this VM' } as any),
    NSI_URL ? checkPlatform('nsi_api', NSI_URL) : Promise.resolve({ status: 'not_configured', details: 'NSI_API_URL not set; downstream platform not deployed on this VM' } as any),
    (async () => {
      try {
        const { getNysKnowledgeClientStats, nysKnowledgeHealthz, isNysKnowledgeConfigured, nysKnowledgeRequest } = await import('../services/jrx-nys-knowledge-client.js');
        const { isNyvFeatureOn } = await import('../config/jrx-feature-flags.js');
        const stats = getNysKnowledgeClientStats();
        if (!isNyvFeatureOn('nysKnowledgePlane')) {
          return { status: 'not_configured', details: 'JRX_F_NYS_KNOWLEDGE_PLANE off', client: stats } as any;
        }
        if (!isNysKnowledgeConfigured()) {
          return { status: 'not_configured', details: 'NYS_KNOWLEDGE_BASE_URL not set', client: stats } as any;
        }
        const probe = await nysKnowledgeHealthz();
        let embeddingSlo: Record<string, unknown> | undefined;
        try {
          const cov = await nysKnowledgeRequest<{
            slo?: { overallStatus?: string; reasons?: string[] };
            coveragePct?: number;
          }>({
            method: 'GET',
            path: '/caselaw/embedding/coverage',
            timeoutMs: 8_000,
          });
          if (cov.ok && cov.data) {
            embeddingSlo = {
              overallStatus: cov.data.slo?.overallStatus ?? 'unknown',
              coveragePct: cov.data.coveragePct,
              reasons: cov.data.slo?.reasons ?? [],
            };
          }
        } catch {
          // Informational only — do not fail plane health on SLO probe
        }
        const classified = resolveNysPlaneHealth({
          flagOn: true,
          configured: true,
          probeOk: probe.ok,
          probeError: probe.error,
          embeddingSloStatus: typeof embeddingSlo?.overallStatus === 'string'
            ? embeddingSlo.overallStatus
            : undefined,
        });
        return {
          status: classified.status,
          latencyMs: probe.latencyMs,
          details: classified.details,
          client: stats,
          circuit: stats.circuit,
          embeddingSlo,
        } as any;
      } catch (e: any) {
        return { status: 'degraded', details: e?.message ?? String(e) } as any;
      }
    })(),
  ]);

  const jwtCheck            = checkJwtSecret();
  const paymentGatewayCheck = checkPaymentGateway();
  const whatsAppCheck       = checkWhatsApp();
  const errorTrackingCheck  = checkErrorTracking();

  const services = {
    database:              dbCheck,
    redis:                 redisCheck,
    llm:                   llmCheck,
    agent_registry:        agentsCheck,
    jwt_security:          jwtCheck,
    payment_gateway:       paymentGatewayCheck,
    whatsapp_notifications: whatsAppCheck,
    error_tracking:        errorTrackingCheck,
    nsp_api:               nspApiCheck,
    nsi_api:               nsiApiCheck,
    nys_knowledge_plane:   nysPlaneCheck,
  };

  // ── Task #28 observability snapshot ─────────────────────────────────
  // Live operator surface: every named opossum breaker (state, errorRate,
  // last failure), per-LLM-provider breaker rollup, BullMQ queue depths
  // (or disabled-reason if no Redis TCP URL is configured), and
  // p50/p95/p99 latency by span name from the in-memory ring buffer.
  // None of these contribute to overallStatus — they're informational —
  // so a tripped breaker shows up immediately on /admin/health/full
  // without flipping liveness probes.
  const breakerNames = listBreakers();
  const breakers: Record<string, ReturnType<typeof getBreakerStats>> = {};
  for (const n of breakerNames) {
    breakers[n] = getBreakerStats(n);
  }

  let queues: any;
  if (!isQueueLive()) {
    queues = {
      enabled: false,
      reason: getQueueDisabledReason() ?? getRedisDisabledReason() ?? 'Redis TCP URL not configured',
      // boot-time vs runtime distinction lets operators tell the difference
      // between "never had Redis" and "Redis went away due to bad password"
      bootEnabled: isQueueEnabled,
    };
  } else {
    try {
      queues = { enabled: true, ...(await getQueueHealth()) };
    } catch (e: any) {
      queues = { enabled: true, error: e?.message ?? String(e) };
    }
  }

  let llmProviders: any[] = [];
  let llmBreakers: ReturnType<typeof getLlmProviderBreakerSnapshot> = {};
  try {
    llmProviders = realLLMService.getProviderHealth();
  } catch { /* tolerated — pre-init */ }
  try {
    llmBreakers = getLlmProviderBreakerSnapshot();
  } catch { /* tolerated — pre-init */ }

  const tracer = {
    ...getTracerStatus(),
    spanLatencies: getSpanLatencies(),
    // Pattern × jurisdiction × tier × agent-tier breakdowns —
    // answers "is queen.orchestrate slower in IN than UK?" without
    // shipping spans to a separate analytics store.
    spanLatenciesByTag: getTaggedSpanLatencies(),
  };

  // ── Operator KPIs added in Task #28 round 2 ─────────────────────────────
  // Each block is wrapped in try/catch so a single missing service can
  // never 500 the whole snapshot — degraded fields surface as
  // `{ error: "..." }` instead.
  // RAG corpus stats. The chunks table is created lazily by rag-service on
  // first ingest, so on a fresh boot it may not exist yet — surface that
  // as `not_initialised:true` rather than as an error, since the platform
  // is still healthy.
  let ragStats: any = { error: 'unavailable' };
  try {
    const exists = await requirePool().query(`SELECT to_regclass('public.knowledge_chunks')::text AS t`);
    if (!exists.rows?.[0]?.t) {
      ragStats = { not_initialised: true, total_chunks: 0 };
    } else {
      const r = await requirePool().query(
        `SELECT
           COUNT(*)::int                              AS total_chunks,
           COUNT(DISTINCT source)::int                AS distinct_sources,
           COUNT(DISTINCT jurisdiction)::int          AS distinct_jurisdictions,
           COUNT(DISTINCT domain)::int                AS distinct_domains,
           COALESCE(SUM(token_count), 0)::bigint      AS total_tokens,
           MAX(created_at)                            AS latest_ingested_at
         FROM knowledge_chunks`,
      );
      ragStats = r.rows?.[0] ?? { total_chunks: 0 };
    }
  } catch (e: any) {
    ragStats = { error: e?.message ?? 'rag corpus query failed' };
  }

  let memoryStats: any = { error: 'unavailable' };
  try {
    const { nvMemoryManager } = await import('../services/jrx-memory-manager.js');
    const s = nvMemoryManager.getStats();
    // NYV-OPS-MEMORY-SHAPE-001 (Task #28 round 5): nvMemoryManager.getStats()
    // returns nested fields ({ session: { entries, hitRate, ... },
    // longterm: { entries, evictedTotal }, social: { entries, backend },
    // pressure: { heapPct, status, ... }, totalRetrievals, totalWrites }).
    // Earlier rounds read flat keys (s.sessionEntries, s.cache) which
    // never existed → memory dashboard was silently zero. Map to the
    // real shape and surface session.hitRate + per-tier counts.
    memoryStats = {
      backend: s.social?.backend ?? 'in-memory',
      pressure: s.pressure,
      tiers: {
        session: {
          entries:        s.session?.entries        ?? 0,
          maxEntries:     s.session?.maxEntries     ?? 0,
          utilizationPct: s.session?.utilizationPct ?? 0,
          hitRate:        s.session?.hitRate        ?? 0,
        },
        longterm: {
          entries:      s.longterm?.entries      ?? 0,
          evictedTotal: s.longterm?.evictedTotal ?? 0,
        },
        social: {
          entries: s.social?.entries ?? 0,
        },
      },
      totals: {
        retrievals: s.totalRetrievals ?? 0,
        writes:     s.totalWrites     ?? 0,
      },
    };
  } catch (e: any) {
    memoryStats = { error: e?.message ?? 'memory stats failed' };
  }

  // HITL queue depth — pending reviews + SLA breaches. Table is created
  // lazily by NvHITLService.requestReview() on first risky output, so a
  // fresh boot reports `not_initialised:true` instead of erroring.
  let hitlQueue: any = { error: 'unavailable' };
  try {
    const exists = await requirePool().query(`SELECT to_regclass('nv_schema.hitl_reviews')::text AS t`);
    if (!exists.rows?.[0]?.t) {
      hitlQueue = { not_initialised: true, pending: 0, total: 0 };
    } else {
      const r = await requirePool().query(
        `SELECT
           COUNT(*) FILTER (WHERE review_status = 'pending')::int  AS pending,
           COUNT(*) FILTER (WHERE review_status = 'approved')::int AS approved,
           COUNT(*) FILTER (WHERE review_status = 'rejected')::int AS rejected,
           COUNT(*) FILTER (WHERE review_status = 'modified')::int AS modified,
           COUNT(*) FILTER (
             WHERE review_status = 'pending'
               AND sla_deadline < NOW()
           )::int                                                  AS sla_breached,
           COUNT(*)::int                                           AS total
         FROM nv_schema.hitl_reviews`,
      );
      hitlQueue = r.rows?.[0] ?? { pending: 0, total: 0 };
    }
  } catch (e: any) {
    hitlQueue = { error: e?.message ?? 'hitl query failed' };
  }

  // NYV-OBS-CACHE-HITRATE-001 (Task #28 round 11): surface
  // prompt-cache hit rates as first-class operator KPIs (the
  // reviewer flagged these as missing). Two distinct caches exist:
  //   * lmCacheService — semantic LLM-output prompt cache (in-process)
  //   * nvRedisCache   — Redis-backed key-value cache (or in-mem fallback)
  // Memory recall hit-rate already surfaces under
  // memory.tiers.session.hitRate. Wrapping each in try/catch
  // because either singleton can be in a partially-initialised
  // state on a fresh boot.
  let promptCacheStats: any = { error: 'unavailable' };
  try {
    const lm = lmCacheService.getStats();
    promptCacheStats = {
      llm_prompt_cache: {
        hits:                    lm.totalHits,
        misses:                  lm.totalMisses,
        hitRate:                 Math.round((lm.hitRate || 0) * 1000) / 1000,
        entries:                 lm.totalEntries,
        hotEntries:              lm.hotEntries,
        warmEntries:             lm.warmEntries,
        coldEntries:             lm.coldEntries,
        evictionCount:           lm.evictionCount,
        estimatedLatencySavedMs: lm.estimatedLatencySavedMs,
        estimatedCostSaved:      lm.estimatedCostSaved,
      },
    };
  } catch (e: any) {
    promptCacheStats = { llm_prompt_cache: { error: e?.message ?? 'lm cache unavailable' } };
  }
  try {
    promptCacheStats.kv_cache = nvRedisCache.getStats();
  } catch (e: any) {
    promptCacheStats.kv_cache = { error: e?.message ?? 'kv cache unavailable' };
  }

  // NYV-OBS-RAG-HITRATE-001 (Task #28 round 11): RAG retrieval
  // hit-rate + average recall latency. Distinct from `rag` (which
  // is a corpus-size snapshot) and from `tracer.spanLatencies['queen.rag']`
  // (which is end-to-end span latency including post-processing).
  // This block answers "how often does retrieval actually return
  // chunks, and how long does the recall step alone take?".
  let ragRetrievalStats: any;
  try {
    ragRetrievalStats = {
      legacy: getRagRetrievalStats(),
      autoRag: getAutoRagStats(),
    };
  } catch (e: any) {
    ragRetrievalStats = { error: e?.message ?? 'rag retrieval stats unavailable' };
  }

  const requestMetrics = getRequestMetricsSnapshot();

  // NV-HEALTH-002 (2026-05-09): `not_configured` is informational (e.g. an
  // optional integration whose env-var was never set). Exclude it from the
  // overall rollup so optional-integration absence doesn't yellow-flag the
  // platform.
  const statuses = Object.values(services)
    .map(s => s.status)
    .filter(s => s !== 'not_configured');
  const overallStatus =
    statuses.length === 0                   ? 'healthy'  :
    statuses.every(s => s === 'healthy')    ? 'healthy'  :
    statuses.some(s => s === 'unhealthy')   ? 'unhealthy' : 'degraded';

  // Setup summary — list all services that need configuration
  const setupRequired = Object.entries(services)
    .filter(([, check]) => check.setup_required)
    .map(([name, check]) => ({ service: name, instructions: check.setup_instructions }));

  const uptimeSec = Math.floor(process.uptime());

  res.status(overallStatus === 'unhealthy' ? 503 : 200).json({
    status:          overallStatus,
    timestamp:       new Date().toISOString(),
    version:         NYV_PLATFORM_VERSION,
    registryVersion: registryStats.registryVersion,
    registryFormat:  registryStats.registryFormat,
    totalAgents:     registryStats.totalAgents,
    uptimeSeconds:   uptimeSec,
    uptimeHuman:     `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`,
    totalResponseMs: Date.now() - startAll,
    platform: {
      name:          `Jurexio Legal AI OS ${NYV_PLATFORM_VERSION}`,
      agents:        registryStats.totalAgents,
      practiceAreas: registryStats.practiceAreas,
      jurisdictions: Object.keys(registryStats.byJurisdiction),
      registryVersion: registryStats.registryVersion,
      registryFormat: registryStats.registryFormat,
      mcpTools:      registryStats.mcpTools,
      topologyCatalog: registryStats.topologyCatalog,
    },
    // NYV-OBS-PUBLIC-REDACT-001 (round 9): public path returns only
    // service-level UP/DOWN status (no internal `details` payloads
    // that may carry version strings, queue modes, or auth hints).
    // Admin path returns the full per-service detail.
    services: isAdmin ? services : Object.fromEntries(
      Object.entries(services).map(([name, check]) => [name, { status: check.status }]),
    ),
    setup_required_count: setupRequired.length,
    // Setup instructions can name internal env vars / integration
    // architecture — admin only.
    ...(isAdmin && setupRequired.length > 0 ? { setup_required: setupRequired } : {}),
    // ── Operator-only telemetry (Task #28). Redacted on public path. ──
    ...(isAdmin
      ? {
          breakers,
          queues,
          // ── NYV-OPS-HEALTH-CONTRACT-001 (Task #28 close-out) ────────────
          // Five operator-contract keys exposed at the top of the admin
          // payload so dashboards / probes can read them without diving
          // into nested service blobs. All five are derived from data
          // already computed above — no extra service calls.
          //
          // queue_depth   — per-queue (waiting + delayed + paused) sum.
          //                 0 across the board means a healthy idle gateway;
          //                 sustained >0 with no `active` is a worker-down
          //                 signal. `null` for a queue means it is disabled
          //                 (no Redis TCP URL) — distinct from 0.
          // breaker_state — per-breaker {state, failures, errorRate}. Pulled
          //                 from the opossum registry plus the global LLM
          //                 breaker (`openrouter-global`) which lives in a
          //                 separate singleton (utils/jrx-circuit-breaker.ts).
          // redis_state   — {connected, reason} derived from the Redis
          //                 health check + the queue/Redis disable reason.
          //                 `connected:false` with `reason:"…not configured"`
          //                 is benign (gateway runs without Redis); other
          //                 reasons are real degradation.
          // registry_size — total agents loaded into the ACTIVE runtime
          //                 registry (the canonical v5.1.0 runtime registry,
          //                 currently 164 agents). This is sourced from
          //                 agent-registry-service so public and admin health
          //                 surfaces stay aligned.
          // voice_routing — sarvam Indic + OpenAI voice availability used by
          //                 the STT/TTS surface in NSP/NSA mobile clients.
          queue_depth: (() => {
            const depths: Record<string, number | null> = {};
            if (queues && queues.enabled === false) return depths; // all-disabled
            const perQueue = (queues && typeof queues === 'object') ? queues : {};
            for (const [qName, qData] of Object.entries(perQueue)) {
              if (qName === 'enabled' || qName === 'error') continue;
              if (qData && typeof qData === 'object') {
                const q: any = qData;
                if (q.disabled || q.enabled === false) {
                  depths[qName] = null;
                } else {
                  depths[qName] =
                    (Number(q.waiting) || 0) +
                    (Number(q.delayed) || 0) +
                    (Number(q.paused) || 0);
                }
              }
            }
            return depths;
          })(),
          // NYV-OPS-STALLED-001 (2026-04-30): two NEW sibling keys so the
          // existing `queue_depth: Record<string, number|null>` contract
          // stays binary-compatible with dashboards/probes. Stalled is an
          // in-process counter incremented every time a worker fails to
          // renew a job lock — sustained growth signals worker thrash or
          // event-loop blocks. dlqDepth is the wait+active+failed sum on
          // the matching `*-dlq` queue (or null if unreachable / 0 if no
          // DLQ has been registered yet for that primary queue).
          queue_stalled: (() => {
            const stalled: Record<string, number | null> = {};
            const perQueue = (queues && typeof queues === 'object') ? queues : {};
            for (const [qName, qData] of Object.entries(perQueue)) {
              if (qName === 'enabled' || qName === 'error') continue;
              if (qData && typeof qData === 'object') {
                const q: any = qData;
                stalled[qName] = (q.disabled || q.enabled === false) ? null : (Number(q.stalled) || 0);
              }
            }
            return stalled;
          })(),
          queue_dlq_depth: (() => {
            const dlq: Record<string, number | null> = {};
            const perQueue = (queues && typeof queues === 'object') ? queues : {};
            for (const [qName, qData] of Object.entries(perQueue)) {
              if (qName === 'enabled' || qName === 'error') continue;
              if (qData && typeof qData === 'object') {
                const q: any = qData;
                if (q.disabled || q.enabled === false) {
                  dlq[qName] = null;
                } else {
                  dlq[qName] = q.dlqDepth ?? null;
                }
              }
            }
            return dlq;
          })(),
          // NV-OPS-QUEUE-COUNTS-001 — additive per-queue waiting/active/failed
          // for BullMQ/EDJ load monitoring (queue_depth remains binary-compat).
          queue_counts: (() => {
            const counts: Record<
              string,
              {
                waiting: number;
                active: number;
                failed: number;
                delayed: number;
                paused: number;
                depth: number;
                warn?: string;
              } | null
            > = {};
            if (queues && queues.enabled === false) return counts;
            const perQueue = (queues && typeof queues === 'object') ? queues : {};
            const warnWaiting = Math.max(1, Number(process.env.NYV_QUEUE_WARN_WAITING) || 50);
            const warnFailed = Math.max(1, Number(process.env.NYV_QUEUE_WARN_FAILED) || 20);
            const warnActive = Math.max(1, Number(process.env.NYV_QUEUE_WARN_ACTIVE) || 40);
            for (const [qName, qData] of Object.entries(perQueue)) {
              if (qName === 'enabled' || qName === 'error') continue;
              if (!qData || typeof qData !== 'object') continue;
              const q: any = qData;
              if (q.disabled || q.enabled === false) {
                counts[qName] = null;
                continue;
              }
              const waiting = Number(q.waiting) || 0;
              const active = Number(q.active) || 0;
              const failed = Number(q.failed) || 0;
              const delayed = Number(q.delayed) || 0;
              const paused = Number(q.paused) || 0;
              const depth = waiting + delayed + paused;
              let warn: string | undefined;
              if (waiting >= warnWaiting || depth >= warnWaiting) warn = 'depth_high';
              else if (failed >= warnFailed) warn = 'failed_high';
              else if (active >= warnActive) warn = 'active_high';
              counts[qName] = { waiting, active, failed, delayed, paused, depth, ...(warn ? { warn } : {}) };
            }
            return counts;
          })(),
          queue_alerts: (() => {
            const alerts: Array<{ queue: string; level: 'warn' | 'crit'; reason: string; waiting: number; active: number; failed: number }> = [];
            if (queues && queues.enabled === false) return alerts;
            const perQueue = (queues && typeof queues === 'object') ? queues : {};
            const warnWaiting = Math.max(1, Number(process.env.NYV_QUEUE_WARN_WAITING) || 50);
            const critWaiting = Math.max(warnWaiting + 1, Number(process.env.NYV_QUEUE_CRIT_WAITING) || 200);
            const warnFailed = Math.max(1, Number(process.env.NYV_QUEUE_WARN_FAILED) || 20);
            const focus = new Set([
              'nyv-ecosystem-doc-job',
              'nyv-ecosystem-doc-job-dlq',
              'nyv-doc-ai',
              'nyv-doc-ai-dlq',
            ]);
            for (const [qName, qData] of Object.entries(perQueue)) {
              if (!focus.has(qName)) continue;
              if (!qData || typeof qData !== 'object') continue;
              const q: any = qData;
              if (q.disabled || q.enabled === false) continue;
              const waiting = Number(q.waiting) || 0;
              const active = Number(q.active) || 0;
              const failed = Number(q.failed) || 0;
              if (waiting >= critWaiting) {
                alerts.push({ queue: qName, level: 'crit', reason: 'waiting_critical', waiting, active, failed });
              } else if (waiting >= warnWaiting) {
                alerts.push({ queue: qName, level: 'warn', reason: 'waiting_elevated', waiting, active, failed });
              }
              if (failed >= warnFailed) {
                alerts.push({ queue: qName, level: 'warn', reason: 'failed_elevated', waiting, active, failed });
              }
            }
            return alerts;
          })(),
          breaker_state: (() => {
            const out: Record<string, { state: string; failures?: number; errorRate?: number }> = {};
            for (const [name, stats] of Object.entries(breakers)) {
              const s: any = stats;
              out[name] = {
                state: s?.state ?? 'unknown',
                failures: s?.failures,
                errorRate: s?.errorRate ?? s?.percentile,
              };
            }
            // Pull in the global LLM breaker singleton (separate from the
            // per-surface registry) so its OPEN/HALF_OPEN state is visible
            // without a second endpoint.
            try {
              const llmGlobal = getCircuitBreakerMetrics();
              if (llmGlobal && typeof llmGlobal === 'object') {
                // Namespace the global LLM breaker to avoid silently
                // overwriting any registry breaker that happens to share
                // the name `openrouter-global`.
                const key = 'openrouter-global' in out
                  ? 'llm:openrouter-global'
                  : 'openrouter-global';
                out[key] = {
                  state: (llmGlobal as any).state ?? 'unknown',
                  failures: (llmGlobal as any).failures,
                  errorRate: (llmGlobal as any).errorRate,
                };
              }
            } catch {
              /* global breaker not initialised yet — fine */
            }
            return out;
          })(),
          redis_state: {
            connected: redisCheck.status === 'healthy',
            status: redisCheck.status,
            reason: redisCheck.status === 'healthy'
              ? null
              : (getRedisDisabledReason()
                 ?? (typeof redisCheck.details === 'string' ? redisCheck.details : null)),
            latencyMs: redisCheck.latencyMs ?? null,
          },
          registry_size: registryStats.totalAgents,
          voice_routing: {
            sarvam: {
              available: !!process.env.SARVAM_API_KEY,
              role: 'Indic STT/TTS/LLM',
            },
            openai_voice: {
              available: !!process.env.OPENAI_API_KEY,
              models: llmCheck.details?.voiceModels ?? [],
            },
          },
          llm_providers: {
            health: llmProviders,
            breakers: llmBreakers,
          },
          tracer,
          rag: ragStats,
          rag_retrieval: ragRetrievalStats,
          prompt_cache:  promptCacheStats,
          memory: memoryStats,
          hitl_queue: hitlQueue,
          requests: requestMetrics,
          dashboards: {
            sentry:     process.env.NYV_SENTRY_DASHBOARD_URL     || null,
            grafana:    process.env.NYV_GRAFANA_DASHBOARD_URL    || null,
            cloudwatch: process.env.NYV_CLOUDWATCH_DASHBOARD_URL || null,
          },
          system: {
            memoryMb:    Math.round(process.memoryUsage().rss        / 1024 / 1024),
            heapUsedMb:  Math.round(process.memoryUsage().heapUsed   / 1024 / 1024),
            heapTotalMb: Math.round(process.memoryUsage().heapTotal  / 1024 / 1024),
            nodeVersion: process.version,
            env:         process.env.NODE_ENV || 'development',
            pid:         process.pid,
          },
        }
      : {}),
  });
});

/* ═══════════════════════════════════════════════════════════
   GET /health/full/deps — Per-dependency drilldown (task #304)
   Returns a uniform shape per dep: { status, lastSuccessAt,
   p50Ms, p95Ms, errorRate7d, recentErrors: [...] }. Sourced from
   the live health probes, the in-memory tracer ring buffers, and
   the nv_router_decisions / nv_audit_logs tables already populated
   by the gateway. No new collection — this endpoint is a pure
   read-side aggregator.
══════════════════════════════════════════════════════════ */
interface DependencySnapshot {
  id: string;
  label: string;
  category: 'datastore' | 'llm' | 'storage';
  status: 'healthy' | 'degraded' | 'unhealthy' | 'not_configured' | 'unknown';
  lastSuccessAt: string | null;
  latencyMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  errorRate7d: number | null;
  callCount7d: number | null;
  recentErrors: Array<{ at: string; message: string; context?: string }>;
  details?: Record<string, unknown>;
}

router.get('/deps', async (req: Request, res: Response) => {
  const startedAt = Date.now();
  // Same redaction model as /health/full: the router is mounted both at
  // /api/jrx/health/full (public) and /api/jrx/admin/health/full (admin-
  // gated). Public callers get a redacted shape — no raw error messages,
  // no audit-log contexts, no config details, no call counts. Only the
  // admin mount sees the full operator-grade payload.
  const isAdminMount = (req.baseUrl || '').includes('/admin/');

  // Re-run the cheap health probes for the deps that have one.
  const [dbCheck, redisCheck] = await Promise.all([checkDatabase(), checkRedis()]);
  const objectStorageConfigured =
    !!process.env.PRIVATE_OBJECT_DIR ||
    !!process.env.PUBLIC_OBJECT_SEARCH_PATHS ||
    !!process.env.OBJECT_STORAGE_BUCKET ||
    !!process.env.NYV_S3_BUCKET ||
    !!process.env.AWS_S3_BUCKET;

  // In-memory tracer ring buffers — pull p50/p95 for span names that
  // map to specific dependencies. The `realLLMService` records spans
  // named `llm.<provider>` per provider, and `db.query` / `redis.ping`
  // are emitted by the data layer.
  const spans = getSpanLatencies();
  const findSpan = (...names: string[]) => {
    for (const n of names) {
      if (spans[n] && spans[n].count > 0) return { name: n, ...spans[n] };
    }
    return null;
  };

  // Provider-level rollup from nv_router_decisions over the last 7d.
  type ProviderAgg = {
    calls: number;
    failures: number;
    last_success_at: string | null;
  };
  const providerAgg = new Map<string, ProviderAgg>();
  const providerErrors = new Map<
    string,
    Array<{ at: string; message: string; context?: string }>
  >();
  interface ProviderAggRow {
    picked_provider: string | null;
    calls: string | number | null;
    failures: string | number | null;
    last_success_at: string | Date | null;
  }
  interface ProviderErrRow {
    picked_provider: string | null;
    ts: string | Date;
    error_message: string | null;
    picked_model_id: string | null;
  }
  try {
    const aggRows = await requirePool().query(`
      SELECT picked_provider,
             COUNT(*)::text AS calls,
             SUM(CASE WHEN ok THEN 0 ELSE 1 END)::text AS failures,
             MAX(CASE WHEN ok THEN ts END) AS last_success_at
      FROM nv_router_decisions
      WHERE ts >= NOW() - INTERVAL '7 days'
      GROUP BY picked_provider
    `);
    for (const r of (aggRows.rows ?? []) as unknown as ProviderAggRow[]) {
      const id = String(r.picked_provider || 'unknown').toLowerCase();
      providerAgg.set(id, {
        calls: Number(r.calls) || 0,
        failures: Number(r.failures) || 0,
        last_success_at: r.last_success_at ? new Date(r.last_success_at).toISOString() : null,
      });
    }

    const errRows = await requirePool().query(`
      SELECT picked_provider, ts, error_message, picked_model_id
      FROM nv_router_decisions
      WHERE ok = false
        AND ts >= NOW() - INTERVAL '7 days'
        AND error_message IS NOT NULL
      ORDER BY ts DESC
      LIMIT 200
    `);
    for (const row of (errRows.rows ?? []) as unknown as ProviderErrRow[]) {
      const id = String(row.picked_provider || 'unknown').toLowerCase();
      const arr = providerErrors.get(id) ?? [];
      if (arr.length >= 5) continue;
      arr.push({
        at: new Date(row.ts).toISOString(),
        message: String(row.error_message ?? '').slice(0, 400),
        context: row.picked_model_id ? String(row.picked_model_id) : undefined,
      });
      providerErrors.set(id, arr);
    }
  } catch {
    /* table may not exist on a fresh boot; deps still render */
  }

  // Recent audit-log errors for db / redis / storage.
  async function recentAuditErrors(needles: string[]): Promise<
    Array<{ at: string; message: string; context?: string }>
  > {
    try {
      const rows = await requirePool().query(`
        SELECT action, metadata, created_at
        FROM nv_schema.nv_audit_logs
        WHERE created_at >= NOW() - INTERVAL '7 days'
          AND (
            ${needles.map((_, i) => `action ILIKE $${i + 1}`).join(' OR ')}
          )
        ORDER BY created_at DESC
        LIMIT 5
      `, needles.map(n => `%${n}%`));
      interface AuditRow {
        action: string | null;
        metadata: Record<string, unknown> | null;
        created_at: string | Date;
      }
      return ((rows.rows ?? []) as unknown as AuditRow[]).map((r) => ({
        at: new Date(r.created_at).toISOString(),
        message: String(r.action ?? ''),
        context:
          r.metadata && typeof r.metadata === 'object'
            ? JSON.stringify(r.metadata).slice(0, 200)
            : undefined,
      }));
    } catch {
      return [];
    }
  }

  const [dbErrors, redisErrors, storageErrors] = await Promise.all([
    recentAuditErrors(['db.error', 'database.error', 'pool.error']),
    recentAuditErrors(['redis.error', 'cache.error']),
    recentAuditErrors(['storage.error', 'object.error', 's3.error']),
  ]);

  const deps: DependencySnapshot[] = [];

  // Postgres
  {
    const dbSpan = findSpan('db.query', 'postgres.query', 'pg.query');
    deps.push({
      id: 'postgres',
      label: 'PostgreSQL',
      category: 'datastore',
      status: dbCheck.status,
      lastSuccessAt: dbCheck.status === 'healthy' ? new Date().toISOString() : null,
      latencyMs: dbCheck.latencyMs ?? null,
      p50Ms: dbSpan?.p50Ms ?? null,
      p95Ms: dbSpan?.p95Ms ?? null,
      errorRate7d: null,
      callCount7d: null,
      recentErrors: dbErrors,
      details: dbCheck.details ? { detail: dbCheck.details } : undefined,
    });
  }

  // Redis
  {
    const rSpan = findSpan('redis.ping', 'redis.get', 'cache.get');
    deps.push({
      id: 'redis',
      label: 'Redis',
      category: 'datastore',
      status: redisCheck.status,
      lastSuccessAt: redisCheck.status === 'healthy' ? new Date().toISOString() : null,
      latencyMs: redisCheck.latencyMs ?? null,
      p50Ms: rSpan?.p50Ms ?? null,
      p95Ms: rSpan?.p95Ms ?? null,
      errorRate7d: null,
      callCount7d: null,
      recentErrors: redisErrors,
      details: redisCheck.details ? { detail: redisCheck.details } : undefined,
    });
  }

  // LLM providers — six explicit deps for the demo audience.
  const llmProviders: Array<{ id: string; label: string; envKeys: string[] }> = [
    { id: 'openai',     label: 'OpenAI',     envKeys: ['OPENAI_API_KEY'] },
    { id: 'anthropic',  label: 'Anthropic',  envKeys: ['ANTHROPIC_API_KEY'] },
    { id: 'google',     label: 'Google',     envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] },
    { id: 'openrouter', label: 'OpenRouter', envKeys: ['OPENROUTER_API_KEY'] },
    { id: 'sarvam',     label: 'Sarvam',     envKeys: ['SARVAM_API_KEY'] },
    { id: 'bedrock',    label: 'AWS Bedrock', envKeys: ['AWS_ACCESS_KEY_ID', 'NV_BEDROCK_ACCESS_KEY_ID'] },
  ];

  for (const p of llmProviders) {
    const configured = p.envKeys.some((k) => !!process.env[k]);
    const agg = providerAgg.get(p.id);
    const span = findSpan(`llm.${p.id}`, `provider.${p.id}`, `${p.id}.complete`);
    const calls = agg?.calls ?? 0;
    const failures = agg?.failures ?? 0;
    const errorRate = calls > 0 ? failures / calls : null;
    let status: DependencySnapshot['status'];
    if (!configured) status = 'not_configured';
    else if (errorRate !== null && errorRate >= 0.5) status = 'unhealthy';
    else if (errorRate !== null && errorRate >= 0.1) status = 'degraded';
    else status = 'healthy';
    deps.push({
      id: p.id,
      label: p.label,
      category: 'llm',
      status,
      lastSuccessAt: agg?.last_success_at ?? null,
      latencyMs: null,
      p50Ms: span?.p50Ms ?? null,
      p95Ms: span?.p95Ms ?? null,
      errorRate7d: errorRate !== null ? Number(errorRate.toFixed(4)) : null,
      callCount7d: calls,
      recentErrors: providerErrors.get(p.id) ?? [],
      details: { configured, missingEnv: configured ? [] : p.envKeys },
    });
  }

  // Object storage
  {
    deps.push({
      id: 'object_storage',
      label: 'Object Storage',
      category: 'storage',
      status: objectStorageConfigured ? 'healthy' : 'not_configured',
      lastSuccessAt: null,
      latencyMs: null,
      p50Ms: null,
      p95Ms: null,
      errorRate7d: null,
      callCount7d: null,
      recentErrors: storageErrors,
      details: {
        configured: objectStorageConfigured,
        bucket:
          process.env.NYV_S3_BUCKET ??
          process.env.AWS_S3_BUCKET ??
          process.env.OBJECT_STORAGE_BUCKET ??
          null,
      },
    });
  }

  // Public mount: same DependencySnapshot shape (so the UI can render
  // without conditional dereferences) but every operationally-sensitive
  // field is nulled/emptied. No raw error messages, no per-call counts,
  // no provider/bucket internals, no probe details.
  const publicDeps: DependencySnapshot[] = deps.map((d) => ({
    id: d.id,
    label: d.label,
    category: d.category,
    status: d.status,
    lastSuccessAt: d.lastSuccessAt,
    latencyMs: null,
    p50Ms: null,
    p95Ms: null,
    errorRate7d: null,
    callCount7d: null,
    recentErrors: [],
    details: undefined,
  }));

  res.json({
    deps: isAdminMount ? deps : publicDeps,
    redacted: !isAdminMount,
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
  });
});

/* ═══════════════════════════════════════════════════════════
   GET /health/ready — Kubernetes readiness probe
   Returns 503 if P0-critical services are down
══════════════════════════════════════════════════════════ */
router.get('/ready', async (_req: Request, res: Response) => {
  /*
   * NV-DEPLOY-DRAIN-001 — fail readiness the moment we start draining, and answer WITHOUT
   * running the DB/LLM checks. A draining container must stop attracting new traffic
   * immediately; making that answer depend on three async probes would keep it "ready" for
   * however long they take, which is the window that produced NSP's 502 on task 387.
   * Liveness deliberately stays 200 — the process is alive, it is just leaving.
   */
  const { isPlatformDraining } = await import('../index.js');
  if (isPlatformDraining()) {
    return void res.status(503).json({
      ready: false,
      draining: true,
      reason: 'shutting_down',
      timestamp: new Date().toISOString(),
    });
  }
  const [dbCheck, llmCheck, agentsCheck] = await Promise.all([
    checkDatabase(),
    checkLLM(),
    checkAgentRegistry(),
  ]);
  const ready = dbCheck.status !== 'unhealthy' && llmCheck.status !== 'degraded';
  res.status(ready ? 200 : 503).json({
    ready,
    timestamp: new Date().toISOString(),
    checks: { database: dbCheck.status, llm: llmCheck.status, agents: agentsCheck.status },
  });
});

/* ═══════════════════════════════════════════════════════════
   GET /health/live  — Kubernetes liveness probe (fast)
══════════════════════════════════════════════════════════ */
router.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ alive: true, timestamp: new Date().toISOString(), pid: process.pid });
});

export default router;
