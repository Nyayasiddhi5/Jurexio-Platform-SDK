/**
 * JRX 10M-Scale Configuration v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Production scale configuration for 10 million subscriber load.
 *
 * SCALE TARGETS:
 *   Peak concurrent users:     100,000
 *   Daily active users:        1,000,000
 *   Monthly active users:      10,000,000
 *   Peak requests/second:      10,000 RPS
 *   Documents indexed/day:     500,000
 *   LLM calls/day:             5,000,000
 *   WebSocket connections:     50,000 concurrent
 *
 * HORIZONTAL SCALING:
 *   Gateway pods:              3–20 (HPA on CPU > 60%)
 *   Orchestration pods:        2–10 (HPA on CPU > 70%)
 *   Job worker pods:           2–8  (HPA on queue depth > 100)
 *   Voice streaming pods:      2–5  (HPA on WS connections > 1000)
 *
 * DATABASE STRATEGY:
 *   Primary:                   1x Neon PostgreSQL (write)
 *   Read replicas:             2x Neon PostgreSQL (reads)
 *   Connection pooling:        PgBouncer (transaction mode, 100 connections/pod)
 *   pgvector:                  HNSW index (m=16, ef_construction=64)
 *   Partitioning:              knowledge_chunks by user_id hash (16 shards)
 *
 * CACHING STRATEGY:
 *   L1 (in-process LRU):       1000 entries, 30s TTL (per-pod)
 *   L2 (Redis cluster):        100GB, 24h TTL for semantic cache
 *   L3 (PostgreSQL):           Materialized views for aggregates (1h refresh)
 *   CDN:                       Static assets + API responses (GET, 5min TTL)
 *
 * @module jrx-scale-config
 * @version 1.0.0
 */

import { resolveRedisTcpUrl } from '../utils/redis-tcp-url.js';

// ─────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const env = (key: string, fallback: string) => process.env[key] ?? fallback;
const envInt = (key: string, fallback: number) => parseInt(process.env[key] ?? String(fallback), 10);
const envBool = (key: string, fallback: boolean) => process.env[key] ? process.env[key] === 'true' : fallback;
const envFloat = (key: string, fallback: number) => parseFloat(process.env[key] ?? String(fallback));

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE CONNECTION POOL
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_DB_POOL = {
  // Primary write pool (per pod)
  write: {
    max: envInt('JRX_DB_POOL_WRITE_MAX', 10),       // 10 write connections per pod
    min: envInt('JRX_DB_POOL_WRITE_MIN', 2),
    idleTimeoutMs: envInt('JRX_DB_IDLE_TIMEOUT_MS', 30_000),
    connectionTimeoutMs: envInt('JRX_DB_CONNECT_TIMEOUT_MS', 10_000),
    statementTimeoutMs: envInt('JRX_DB_STATEMENT_TIMEOUT_MS', 30_000),
    maxLifetimeMs: envInt('JRX_DB_MAX_LIFETIME_MS', 1_800_000), // 30min
    keepalive: true,
  },

  // Read replica pool (per pod) — route read-heavy queries here
  read: {
    url: env('JRX_DATABASE_READ_URL', env('DATABASE_URL', '')),
    max: envInt('JRX_DB_POOL_READ_MAX', 20),        // 20 read connections per pod
    min: envInt('JRX_DB_POOL_READ_MIN', 3),
    idleTimeoutMs: 60_000,
    connectionTimeoutMs: 5_000,
    statementTimeoutMs: 15_000,
  },

  // PgBouncer (if deployed externally)
  pgBouncer: {
    enabled: envBool('JRX_PGBOUNCER_ENABLED', false),
    url: env('JRX_PGBOUNCER_URL', ''),
    poolMode: env('JRX_PGBOUNCER_POOL_MODE', 'transaction'), // transaction|session|statement
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// REDIS CLUSTER
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_REDIS_CLUSTER = {
  // Single Redis URL (Upstash / Aiven / ElastiCache)
  url: env('REDIS_URL', env('JRX_REDIS_URL', '')),

  // Cluster nodes (for Redis Cluster mode)
  clusterMode: envBool('JRX_REDIS_CLUSTER_MODE', false),
  nodes: env('JRX_REDIS_NODES', '').split(',').filter(Boolean), // "host:port,host:port"

  // Connection settings
  maxRetries: envInt('JRX_REDIS_MAX_RETRIES', 3),
  retryDelayMs: envInt('JRX_REDIS_RETRY_DELAY_MS', 50),
  connectTimeoutMs: envInt('JRX_REDIS_CONNECT_TIMEOUT_MS', 5_000),
  commandTimeoutMs: envInt('JRX_REDIS_COMMAND_TIMEOUT_MS', 3_000),
  keepalive: true,

  // Key prefixes per service
  prefixes: {
    semantic:   'nyv:sem:',      // LLM response cache
    session:    'nyv:sess:',     // User sessions
    rateLimit:  'nyv:rate:',     // Rate limit counters
    agent:      'nyv:agent:',    // Agent state
    statute:    'nyv:statute:',  // Statute lookups
    embedding:  'nyv:emb:',      // Embedding cache
    queue:      'nyv:queue:',    // Job queue metadata
    lock:       'nyv:lock:',     // Distributed locks
  },

  // TTLs (seconds)
  ttl: {
    semantic:   86_400,          // 24 hours
    session:    28_800,          // 8 hours
    rateLimit:  60,              // 1 minute
    agent:      1_800,           // 30 minutes
    statute:    604_800,         // 7 days
    embedding:  86_400,          // 24 hours
    lock:       30,              // 30 seconds
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMITING (per subscription tier)
// ─────────────────────────────────────────────────────────────────────────────

export type SubscriptionTier = 'free' | 'pro' | 'enterprise' | 'internal';

export const JRX_RATE_LIMITS: Record<SubscriptionTier, {
  requestsPerMinute: number;
  requestsPerDay: number;
  tokensPerDay: number;
  tokensPerRequest: number;
  concurrentRequests: number;
  fileUploadMb: number;
  documentsPerDay: number;
  agentsPerSession: number;
}> = {
  free: {
    requestsPerMinute:  10,
    requestsPerDay:     1_000,
    tokensPerDay:       100_000,
    tokensPerRequest:   4_000,
    concurrentRequests: 5,
    fileUploadMb:       10,
    documentsPerDay:    10,
    agentsPerSession:   3,
  },
  pro: {
    requestsPerMinute:  60,
    requestsPerDay:     10_000,
    tokensPerDay:       1_000_000,
    tokensPerRequest:   32_000,
    concurrentRequests: 20,
    fileUploadMb:       100,
    documentsPerDay:    100,
    agentsPerSession:   20,
  },
  enterprise: {
    requestsPerMinute:  600,
    requestsPerDay:     500_000,
    tokensPerDay:       50_000_000,
    tokensPerRequest:   200_000,
    concurrentRequests: -1,           // Unlimited
    fileUploadMb:       1_000,
    documentsPerDay:    10_000,
    agentsPerSession:   148,          // All ROMA L5 agents
  },
  internal: {
    requestsPerMinute:  -1,           // No limit
    requestsPerDay:     -1,
    tokensPerDay:       -1,
    tokensPerRequest:   -1,
    concurrentRequests: -1,
    fileUploadMb:       -1,
    documentsPerDay:    -1,
    agentsPerSession:   -1,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// HORIZONTAL SCALING (HPA)
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_HPA = {
  gateway: {
    minReplicas: envInt('JRX_HPA_GATEWAY_MIN', 3),
    maxReplicas: envInt('JRX_HPA_GATEWAY_MAX', 20),
    cpuThreshold: envInt('JRX_HPA_GATEWAY_CPU', 60),         // Scale up at 60% CPU
    memThreshold: envInt('JRX_HPA_GATEWAY_MEM', 75),         // Scale up at 75% memory
    targetRps: envInt('JRX_HPA_GATEWAY_RPS', 500),           // Target 500 RPS per pod
  },
  orchestration: {
    minReplicas: envInt('JRX_HPA_ORCH_MIN', 2),
    maxReplicas: envInt('JRX_HPA_ORCH_MAX', 10),
    cpuThreshold: envInt('JRX_HPA_ORCH_CPU', 70),
    memThreshold: envInt('JRX_HPA_ORCH_MEM', 80),
  },
  jobWorker: {
    minReplicas: envInt('JRX_HPA_WORKER_MIN', 2),
    maxReplicas: envInt('JRX_HPA_WORKER_MAX', 8),
    queueDepthThreshold: envInt('JRX_HPA_WORKER_QUEUE', 100), // Scale up if queue > 100
  },
  voice: {
    minReplicas: envInt('JRX_HPA_VOICE_MIN', 2),
    maxReplicas: envInt('JRX_HPA_VOICE_MAX', 5),
    wsConnectionThreshold: envInt('JRX_HPA_VOICE_WS', 1_000), // Scale per 1000 WS connections
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// RESOURCE LIMITS (per pod)
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_RESOURCES = {
  gateway: {
    cpu:    { request: '500m', limit: '2000m' },
    memory: { request: '512Mi', limit: '2Gi' },
  },
  orchestration: {
    cpu:    { request: '1000m', limit: '4000m' },
    memory: { request: '1Gi',  limit: '4Gi' },
  },
  jobWorker: {
    cpu:    { request: '500m', limit: '2000m' },
    memory: { request: '512Mi', limit: '2Gi' },
  },
  voice: {
    cpu:    { request: '500m', limit: '1000m' },
    memory: { request: '256Mi', limit: '1Gi' },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// JOB QUEUE SCALE
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_QUEUE_SCALE = {
  queues: {
    './jrx-ai': {
      concurrency: envInt('JRX_QUEUE_AI_CONCURRENCY', 5),
      priority: 10,
      timeoutMs: envInt('JRX_QUEUE_AI_TIMEOUT_MS', 120_000),    // 2 min
      maxAttempts: 3,
    },
    './jrx-documents': {
      concurrency: envInt('JRX_QUEUE_DOC_CONCURRENCY', 3),
      priority: 5,
      timeoutMs: envInt('JRX_QUEUE_DOC_TIMEOUT_MS', 300_000),   // 5 min
      maxAttempts: 2,
    },
    './jrx-compliance': {
      concurrency: envInt('JRX_QUEUE_COMP_CONCURRENCY', 2),
      priority: 7,
      timeoutMs: envInt('JRX_QUEUE_COMP_TIMEOUT_MS', 180_000),  // 3 min
      maxAttempts: 3,
    },
    'default': {
      concurrency: envInt('JRX_QUEUE_DEFAULT_CONCURRENCY', 5),
      priority: 1,
      timeoutMs: envInt('JRX_QUEUE_DEFAULT_TIMEOUT_MS', 60_000), // 1 min
      maxAttempts: 3,
    },
  },
  pollIntervalMs: envInt('JRX_QUEUE_POLL_INTERVAL_MS', 3_000),
  lockTimeoutMs: envInt('JRX_QUEUE_LOCK_TIMEOUT_MS', 300_000),
  maxBatchSize: envInt('JRX_QUEUE_BATCH_SIZE', 10),
  deadLetterAfterAttempts: envInt('JRX_QUEUE_DEAD_LETTER_ATTEMPTS', 5),
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// PGVECTOR INDEX CONFIG
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_PGVECTOR = {
  // HNSW index parameters (tune for 10M scale)
  hnsw: {
    m: envInt('JRX_PGVECTOR_HNSW_M', 16),              // Max connections per layer
    efConstruction: envInt('JRX_PGVECTOR_EF_CONSTRUCTION', 64),
    efSearch: envInt('JRX_PGVECTOR_EF_SEARCH', 40),    // Higher = more accurate, slower
  },
  // IVFFlat alternative (for very large datasets)
  ivfflat: {
    lists: envInt('JRX_PGVECTOR_IVFFLAT_LISTS', 100),  // sqrt(N) where N = num vectors
    probes: envInt('JRX_PGVECTOR_IVFFLAT_PROBES', 10),
  },
  // Embedding dimension (must match embedding model)
  dimension: envInt('JRX_EMBEDDING_DIMENSION', 1536),   // OpenAI text-embedding-3-small
  distanceFunction: env('JRX_PGVECTOR_DISTANCE', 'cosine') as 'cosine' | 'l2' | 'inner_product',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_OBSERVABILITY = {
  // Metrics
  metrics: {
    provider: env('JRX_METRICS_PROVIDER', 'prometheus') as 'prometheus' | 'datadog' | 'cloudwatch',
    port: envInt('JRX_METRICS_PORT', 9090),
    path: env('JRX_METRICS_PATH', '/metrics'),
    scrapeIntervalSecs: envInt('JRX_METRICS_SCRAPE_INTERVAL', 15),
    labels: {
      service: env('JRX_SERVICE_NAME', 'jrx-gateway'),
      env: env('NODE_ENV', 'development'),
      version: env('JRX_VERSION', '3.1.2'),
      region: env('JRX_REGION', 'ap-south-1'),
    },
  },

  // Distributed tracing (OpenTelemetry)
  tracing: {
    provider: env('JRX_TRACING_PROVIDER', 'opentelemetry'),
    exporterUrl: env('JRX_OTEL_EXPORTER_URL', ''),      // OTLP gRPC endpoint
    sampleRate: envFloat('JRX_OTEL_SAMPLE_RATE', 0.1),  // 10% sampling in prod
    serviceName: env('JRX_SERVICE_NAME', 'jrx-gateway'),
  },

  // Error tracking
  sentry: {
    dsn: env('JRX_SENTRY_DSN', env('SENTRY_DSN', '')),
    enabled: envBool('JRX_SENTRY_ENABLED', false),
    tracesSampleRate: envFloat('JRX_SENTRY_TRACES_SAMPLE_RATE', 0.05),
    environment: env('NODE_ENV', 'development'),
    release: env('JRX_RELEASE', '3.1.2'),
  },

  // Health checks
  health: {
    liveness: {
      path: '/api/jrx/health',
      intervalSecs: 30,
      failureThreshold: 3,
    },
    readiness: {
      path: '/api/jrx/health/full',
      intervalSecs: 10,
      failureThreshold: 2,
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// CDN + CACHING HEADERS
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_CDN = {
  enabled: envBool('JRX_CDN_ENABLED', false),
  provider: env('JRX_CDN_PROVIDER', 'cloudfront') as 'cloudfront' | 'cloudflare' | 'fastly',
  origin: env('JRX_CDN_ORIGIN', ''),

  // Cache control headers per endpoint type
  cacheControl: {
    static:       'public, max-age=31536000, immutable',             // Assets with hash
    apiGet:       'private, max-age=300, must-revalidate',           // GET API responses (5min)
    apiStream:    'no-store',                                         // Streaming responses
    apiMutate:    'no-store, no-cache',                              // POST/PUT/DELETE
    healthCheck:  'no-store',
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY AT SCALE
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_SECURITY_SCALE = {
  // DDoS protection
  ddos: {
    enabled: envBool('JRX_DDOS_PROTECTION', true),
    maxRequestBodyMb: envInt('JRX_MAX_REQUEST_BODY_MB', 100),
    ipBanThreshold: envInt('JRX_IP_BAN_THRESHOLD', 1000),  // 1000 req/min = ban
    ipBanDurationMs: envInt('JRX_IP_BAN_DURATION_MS', 3_600_000), // 1 hour
  },

  // JWT
  jwt: {
    expirySeconds: envInt('JRX_JWT_EXPIRY_SECONDS', 3600),         // 1 hour
    refreshExpirySeconds: envInt('JRX_JWT_REFRESH_EXPIRY', 604800), // 7 days
    algorithm: 'HS256' as const,
    rotationDays: envInt('JRX_JWT_ROTATION_DAYS', 30),
  },

  // CORS
  cors: {
    origins: env('JRX_CORS_ORIGINS', '*').split(',').filter(Boolean),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-JRX-Signature', 'X-JRX-Timestamp', 'X-JRX-Trace-Id'],
    exposedHeaders: ['X-JRX-Trace-Id', 'X-JRX-Tier', 'X-RateLimit-Tier', 'Retry-After'],
    maxAgeSecs: 86400,
    credentials: true,
  },

  // Encryption at rest (document storage)
  encryption: {
    algorithm: 'aes-256-gcm',
    keyRotationDays: envInt('JRX_ENCRYPTION_KEY_ROTATION_DAYS', 90),
    kmsProvider: env('JRX_KMS_PROVIDER', 'local') as 'local' | 'aws_kms' | 'gcp_kms',
    kmsKeyId: env('JRX_KMS_KEY_ID', ''),
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// FUTURE-PROOFING: AGI + QUANTUM COMPUTING
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_FUTURE = {
  // Post-quantum cryptography (NIST PQC Standard 2024)
  quantumReady: {
    enabled: envBool('JRX_QUANTUM_ENABLED', false),
    kemAlgorithm: 'ML-KEM-512',           // CRYSTALS-Kyber (FIPS 203)
    sigAlgorithm: 'ML-DSA-44',            // CRYSTALS-Dilithium (FIPS 204)
    signatureAlgorithm: 'SLH-DSA-SHA2-128s', // SPHINCS+ (FIPS 205)
    migrationPlan: '2026-Q2',             // Target migration quarter
    hybridMode: true,                     // Use classical + PQC in parallel until migration
  },

  // AGI readiness
  agiReadiness: {
    modelContextWindow: 1_000_000,        // 1M token context target (2026+)
    multiAgentParallelism: 148,           // ROMA L5 full agent concurrency
    reasoningDepth: 'o3-level',          // Target reasoning capability
    planningHorizon: '10-year',          // Platform designed for 10-year MOAT
  },

  // Domain agnosticism
  domainAgnostic: {
    // Jurexio can be extended to any legal/compliance domain
    // by adding jurisdiction packs without modifying core
    extensionPoints: ['jurisdiction', 'legalDomain', 'documentClass', 'agentSpec', 'llmProvider'],
    pluginInterface: 'JrxPlugin',         // jrx-integration-plugin-manager.ts
    apiVersion: 'v1',                     // Semver API versioning
    backwardCompatibilityYears: 5,        // 5-year backward compat guarantee
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// SCALE READINESS CHECK
// ─────────────────────────────────────────────────────────────────────────────

export function getScaleReadinessReport(): {
  isProductionReady: boolean;
  score: number;               // 0–100
  checks: Record<string, boolean>;
  recommendations: string[];
} {
  const checks: Record<string, boolean> = {
    database_url: !!process.env.DATABASE_URL,
    jwt_secret: !!process.env.JRX_JWT_SECRET || !!process.env.JWT_SECRET,
    openai_key: !!process.env.OPENAI_API_KEY || !!process.env.OPENROUTER_API_KEY,
    redis_configured: resolveRedisTcpUrl().enabled, // NV-SECRETS-001
    storage_configured: process.env.JRX_STORAGE_BACKEND !== 'local',
    sentry_configured: !!process.env.JRX_SENTRY_DSN,
    rate_limiting: true,       // Always enabled
    cors_configured: !!process.env.JRX_CORS_ORIGINS,
    read_replica: !!process.env.JRX_DATABASE_READ_URL,
    pgbouncer: !!process.env.JRX_PGBOUNCER_URL,
    cdn_configured: !!process.env.JRX_CDN_ORIGIN,
    quantum_ready: !!process.env.JRX_QUANTUM_ENABLED,
  };

  const criticalChecks = ['database_url', 'jwt_secret', 'openai_key'];
  const allCritical = criticalChecks.every(k => checks[k]);
  const score = Math.round(Object.values(checks).filter(Boolean).length / Object.keys(checks).length * 100);

  const recommendations: string[] = [];
  if (!checks.redis_configured) recommendations.push('Configure REDIS_URL for distributed caching and rate limiting');
  if (!checks.storage_configured) recommendations.push('Set JRX_STORAGE_BACKEND=s3 and configure S3 credentials for production');
  if (!checks.sentry_configured) recommendations.push('Configure JRX_SENTRY_DSN for error tracking');
  if (!checks.cors_configured) recommendations.push('Set JRX_CORS_ORIGINS to restrict CORS origins in production');
  if (!checks.read_replica) recommendations.push('Configure JRX_DATABASE_READ_URL for read replica to reduce write DB load');
  if (!checks.cdn_configured) recommendations.push('Configure CDN (Cloudflare/CloudFront) for static asset caching');
  if (!checks.quantum_ready) recommendations.push('Enable JRX_QUANTUM_ENABLED=true before 2026-Q2 for post-quantum migration');

  return {
    isProductionReady: allCritical && score >= 60,
    score,
    checks,
    recommendations,
  };
}

export default {
  JRX_DB_POOL,
  JRX_REDIS_CLUSTER,
  JRX_RATE_LIMITS,
  JRX_HPA,
  JRX_RESOURCES,
  JRX_QUEUE_SCALE,
  JRX_PGVECTOR,
  JRX_OBSERVABILITY,
  JRX_CDN,
  JRX_SECURITY_SCALE,
  JRX_FUTURE,
  getScaleReadinessReport,
};
