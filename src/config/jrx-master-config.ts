/**
 * JRX MASTER CONFIG v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for ALL Jurexio Enterprise Platform configuration.
 * Every environment variable, feature flag, provider setting, and runtime
 * tunable lives here. Import from this file, never from scattered env reads.
 *
 * Naming convention:
 *   JRX_* env vars  → Jurexio Enterprise Platform (this SDK)
 *   JRX_ECOSYSTEM_* env vars  → Jurexio ecosystem overrides
 *
 * Usage:
 *   import { JRX_CONFIG } from '../config/jrx-master-config.js';
 *   const key = JRX_CONFIG.llm.providers.openai.apiKey;
 *
 * @module jrx-master-config
 * @version 1.0.0
 * @since 2026-04-04
 */

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) return '';
  return val;
}

function envBool(key: string, defaultVal = false): boolean {
  const val = process.env[key];
  if (val === undefined) return defaultVal;
  return val.toLowerCase() !== 'false' && val !== '0';
}

function envInt(key: string, defaultVal: number): number {
  const val = process.env[key];
  if (!val) return defaultVal;
  const n = parseInt(val, 10);
  return isNaN(n) ? defaultVal : n;
}

function envFloat(key: string, defaultVal: number): number {
  const val = process.env[key];
  if (!val) return defaultVal;
  const n = parseFloat(val);
  return isNaN(n) ? defaultVal : n;
}

function envList(key: string, defaultVal: string[] = []): string[] {
  const val = process.env[key];
  if (!val) return defaultVal;
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM IDENTITY
// ─────────────────────────────────────────────────────────────────────────────

// ─── Single source of truth for platform version (JRX-AUDIT 2026-05-05) ──────
export const JRX_PLATFORM_VERSION = '5.0.0';
export const JRX_SDK_VERSION = '5.0.0';

export const JRX_PLATFORM = {
  name: 'Jurexio',
  fullName: 'Jurexio Enterprise Platform',
  prefix: 'JRX',
  version: JRX_PLATFORM_VERSION,
  sdkVersion: JRX_SDK_VERSION,
  sdkName: 'JRX SDK',
  tagline: "India's Sovereign Legal AI Operating System",
  ecosystem: 'Jurexio',
  ecosystemPrefix: 'NYS',
  gatewayPort: envInt('PORT', 5000),
  consolePort: envInt('JRX_CONSOLE_PORT', 3004),
  baseApiPath: '/api/jrx',
  wsBasePath: '/ws/jrx',
  demo: {
    email: process.env.JRX_DEMO_EMAIL ?? '',
    password: process.env.JRX_DEMO_PASSWORD ?? '',
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// NYS PLATFORM REGISTRY (5 Consumer Platforms)
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_ECOSYSTEM_PLATFORMS = {
  NYM: {
    code: 'NYM',
    name: 'Jurexio Citizen',
    fullName: 'Jurexio Citizen',
    audience: 'Citizens',
    apiPath: '/api/jrx/nym',
    dbPrefix: 'nym_',
    sdkClientId: 'nyv_app_jurexio-citizen_consumer_intake_v1',
    defaultLLM: 'gemini-2.5-flash',
    fallbackLLM: 'gpt-4.1-nano',
    llmTier: 'minimal',
    maxTokensPerRequest: 2048,
    rateLimitPerMinute: 100,
    dailyTokenBudget: 500_000,
    monthlyTokenBudget: 15_000_000,
    storageQuotaGb: 5,
    maxDocSizeMb: 25,
  },
  'JRX-PRO': {
    code: 'JRX-PRO',
    name: 'Jurexio Professional™',
    fullName: 'Jurexio Professional™',
    audience: 'Lawyers & Law Firms',
    apiPath: '/api/jrx/pro',
    dbPrefix: 'nys_pro_',
    sdkClientId: 'nyv_app_nyayasiddhi_professional_v1',
    defaultLLM: 'claude-sonnet-4-6',
    fallbackLLM: 'gpt-4.1',
    llmTier: 'balanced',
    maxTokensPerRequest: 16384,
    rateLimitPerMinute: 60,
    dailyTokenBudget: 200_000,
    monthlyTokenBudget: 6_000_000,
    storageQuotaGb: 150,
    maxDocSizeMb: 100,
  },
  'JRX-INS': {
    code: 'JRX-INS',
    name: 'Jurexio Institutional™',
    fullName: 'Jurexio Institutional™',
    audience: 'Enterprise & Large Law Firms',
    apiPath: '/api/jrx/ins',
    dbPrefix: 'nys_ins_',
    sdkClientId: 'nyv_app_nyayasiddhi_institutional_v1',
    defaultLLM: 'claude-opus-4-6',
    fallbackLLM: 'o3',
    llmTier: 'premium',
    maxTokensPerRequest: 32768,
    rateLimitPerMinute: 120,
    dailyTokenBudget: 1_000_000,
    monthlyTokenBudget: 30_000_000,
    storageQuotaGb: 1000,
    maxDocSizeMb: 500,
  },
  'JRX-ACE': {
    code: 'JRX-ACE',
    name: 'Jurexio Academy™',
    fullName: 'Jurexio Academy™',
    audience: 'Law Students & Professionals',
    apiPath: '/api/jrx/ace',
    dbPrefix: 'nys_ace_',
    sdkClientId: 'nyv_app_nyayasiddhi_academy_v1',
    defaultLLM: 'gpt-4.1',
    fallbackLLM: 'gemini-2.5-flash',
    llmTier: 'balanced',
    maxTokensPerRequest: 8192,
    rateLimitPerMinute: 80,
    dailyTokenBudget: 300_000,
    monthlyTokenBudget: 9_000_000,
    storageQuotaGb: 50,
    maxDocSizeMb: 50,
  },
  'JRX-MIN': {
    code: 'JRX-MIN',
    name: 'Jurexio Ministry™',
    fullName: 'Jurexio Ministry™',
    audience: 'Government & Ministries',
    apiPath: '/api/jrx/gov',
    dbPrefix: 'nys_min_',
    sdkClientId: 'nyv_app_nyayasiddhi_governance_v1',
    defaultLLM: 'o3',
    fallbackLLM: 'claude-opus-4-6',
    llmTier: 'premium',
    maxTokensPerRequest: 32768,
    rateLimitPerMinute: 200,
    dailyTokenBudget: 2_000_000,
    monthlyTokenBudget: 60_000_000,
    storageQuotaGb: -1, // Unlimited
    maxDocSizeMb: 1000,
  },
} as const;

export type NYSPlatformCode = keyof typeof JRX_ECOSYSTEM_PLATFORMS;

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_DATABASE = {
  // Primary connection (Neon serverless)
  url: env('DATABASE_URL', env('JRX_DATABASE_URL', '')),
  poolMin: envInt('JRX_DB_POOL_MIN', 2),
  poolMax: envInt('JRX_DB_POOL_MAX', 20),
  idleTimeoutMs: envInt('JRX_DB_IDLE_TIMEOUT_MS', 30_000),
  connectTimeoutMs: envInt('JRX_DB_CONNECT_TIMEOUT_MS', 10_000),
  statementTimeoutMs: envInt('JRX_DB_STATEMENT_TIMEOUT_MS', 60_000),
  ssl: envBool('JRX_DB_SSL', true),

  // Schema namespaces (canonical — use JRX/NYS prefixes)
  schemas: {
    nyv: 'nyv_schema',    // Jurexio platform tables (nyv_*)
    nys: 'nys_schema',    // Jurexio ecosystem tables (nys_*)
    drizzle: 'drizzle',   // Drizzle migration tracking
    public: 'public',     // Default PostgreSQL
  },

  // Read replica for analytics (optional)
  readReplicaUrl: env('JRX_DB_READ_REPLICA_URL', ''),

  // Vector extension
  pgvectorEnabled: envBool('JRX_PGVECTOR_ENABLED', true),
  vectorDimension: envInt('JRX_VECTOR_DIMENSION', 1536), // text-embedding-3-small default

  // Job queue
  jobQueues: ['jrx-ai', 'jrx-documents', 'jrx-compliance', 'jrx-default'] as const,
  jobPollIntervalMs: envInt('JRX_JOB_POLL_INTERVAL_MS', 5_000),
  jobLockTimeoutMs: envInt('JRX_JOB_LOCK_TIMEOUT_MS', 300_000),
  jobMaxBatchSize: envInt('JRX_JOB_MAX_BATCH_SIZE', 10),
  jobMaxRetries: envInt('JRX_JOB_MAX_RETRIES', 3),
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// REDIS / CACHE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_CACHE = {
  redisUrl: env('JRX_REDIS_URL', env('REDIS_URL', '')),
  redisPassword: env('JRX_REDIS_PASSWORD', env('REDIS_PASSWORD', '')),
  redisTls: envBool('JRX_REDIS_TLS', false),
  maxReconnectAttempts: envInt('JRX_REDIS_RECONNECT_ATTEMPTS', 10),
  reconnectDelayMs: envInt('JRX_REDIS_RECONNECT_DELAY_MS', 1_000),
  get isRedisConfigured(): boolean { return !!this.redisUrl; },

  // In-memory LRU fallback (per-pod, not shared)
  lruMaxSize: envInt('JRX_LRU_MAX_SIZE', 2000),

  // TTL policies (milliseconds)
  ttl: {
    semanticCache: envInt('JRX_TTL_SEMANTIC_CACHE_MS', 300_000),        // 5 min hot
    semanticCacheWarm: envInt('JRX_TTL_SEMANTIC_WARM_MS', 3_600_000),   // 1 hour warm
    semanticCacheCold: envInt('JRX_TTL_SEMANTIC_COLD_MS', 86_400_000),  // 24 hours cold
    rateLimitWindow: envInt('JRX_TTL_RATE_LIMIT_MS', 60_000),           // 1 min
    session: envInt('JRX_TTL_SESSION_MS', 14_400_000),                   // 4 hours
    statuteQuery: envInt('JRX_TTL_STATUTE_MS', 3_600_000),              // 1 hour
    mcpToolIdempotent: envInt('JRX_TTL_MCP_TOOL_MS', 300_000),         // 5 min
    agentCapabilities: envInt('JRX_TTL_AGENT_CAP_MS', 900_000),        // 15 min
    ragEmbedding: envInt('JRX_TTL_RAG_EMBED_MS', 86_400_000),          // 24 hours
  },

  // Cache namespaces (Redis key prefix)
  keyPrefix: {
    semantic: 'nyv:sem:',
    rateLimit: 'nyv:rl:',
    session: 'nyv:sess:',
    statute: 'nyv:stat:',
    mcp: 'nyv:mcp:',
    agent: 'nyv:agent:',
    rag: 'nyv:rag:',
    jobResult: 'nyv:job:',
    wsSession: 'nyv:ws:',
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT STORAGE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Storage backends (priority order):
 *   1. S3-compatible (production) — JRX_STORAGE_BACKEND=s3
 *   2. GCS (Google Cloud) — JRX_STORAGE_BACKEND=gcs
 *   3. Local filesystem — JRX_STORAGE_BACKEND=local (dev fallback)
 *
 * Document path structure (per-user/per-lawyer):
 *   {bucket}/{orgId}/{platform}/{userId}/documents/{docId}/{fileName}
 *   {bucket}/{orgId}/{platform}/{userId}/statutes/{jurisdiction}/{fileName}
 *   {bucket}/{orgId}/{platform}/{userId}/compliance/{framework}/{fileName}
 *   {bucket}/global/statutes/{jurisdiction}/{statuteCode}/{fileName}
 */

export type StorageBackend = 's3' | 'gcs' | 'local';

function detectStorageBackend(): StorageBackend {
  const explicit = env('JRX_STORAGE_BACKEND', '');
  if (explicit) {
    // Silently map legacy 'replit' to 'local' (no Replit storage in Cursor/AWS stacks).
    if (explicit === 'replit') return 'local';
    return explicit as StorageBackend;
  }
  // AWS / Cursor Cloud production: when an S3 bucket is configured, use it.
  if (env('JRX_S3_BUCKET', '') || env('AWS_S3_BUCKET', '')) return 's3';
  // Safe local fallback for dev / misconfigured envs so document jobs fail-soft.
  return 'local';
}

export const JRX_STORAGE = {
  backend: detectStorageBackend(),

  // S3 / S3-compatible (MinIO, DigitalOcean Spaces, Cloudflare R2, etc.)
  s3: {
    bucket: env('JRX_S3_BUCKET', 'jrx-documents'),
    region: env('JRX_S3_REGION', 'ap-south-1'),     // Mumbai for India-first
    accessKeyId: env('JRX_S3_ACCESS_KEY_ID', env('AWS_ACCESS_KEY_ID', '')),
    secretAccessKey: env('JRX_S3_SECRET_ACCESS_KEY', env('AWS_SECRET_ACCESS_KEY', '')),
    endpoint: env('JRX_S3_ENDPOINT', ''),            // empty = AWS S3; set for custom
    forcePathStyle: envBool('JRX_S3_FORCE_PATH_STYLE', false),
    signedUrlExpirySeconds: envInt('JRX_S3_SIGNED_URL_EXPIRY', 3600),
    serverSideEncryption: env('JRX_S3_SSE', 'AES256'),
    multipartThresholdMb: envInt('JRX_S3_MULTIPART_THRESHOLD_MB', 50),
    multipartChunkMb: envInt('JRX_S3_MULTIPART_CHUNK_MB', 10),
    get isConfigured(): boolean { return !!(this.accessKeyId && this.secretAccessKey); },
  },

  // Google Cloud Storage
  gcs: {
    bucket: env('JRX_GCS_BUCKET', 'jrx-documents'),
    projectId: env('JRX_GCS_PROJECT_ID', ''),
    keyFilePath: env('JRX_GCS_KEY_FILE', ''),
    signedUrlExpirySeconds: envInt('JRX_GCS_SIGNED_URL_EXPIRY', 3600),
    get isConfigured(): boolean { return !!(this.projectId && this.keyFilePath); },
  },

  // Local filesystem (dev only)
  local: {
    basePath: env('JRX_LOCAL_STORAGE_PATH', './uploads/jrx-documents'),
    tempPath: env('JRX_LOCAL_TEMP_PATH', './uploads/jrx-temp'),
  },

  // Storage path templates — DEPRECATED for runtime uploads.
  // SSoT: StoragePathBuilder in src/services/jrx-document-storage-service.ts
  // (orgs/{orgId}/{platform}/users/{userId}/documents/{docId}/{fileName}, etc.).
  // These legacy helpers remain for jrx-sdk-production-config.ts compatibility only;
  // new code MUST call StoragePathBuilder directly.
  paths: {
    /** @deprecated Use StoragePathBuilder.userDocument(orgId, platform, userId, docId, fileName) */
    userDocuments: (orgId: string, platform: string, userId: string, docId: string, fileName?: string) =>
      `orgs/${orgId}/${platform}/users/${userId}/documents/${docId}/${fileName || 'document'}`,
    /** @deprecated Use StoragePathBuilder.parsedContent */
    userDocumentsProcessed: (orgId: string, platform: string, userId: string, docId: string) =>
      `orgs/${orgId}/${platform}/users/${userId}/parsed/${docId}/content.json`,
    /** @deprecated archived docs — align with userDocument + metadata tag */
    userDocumentsArchived: (orgId: string, platform: string, userId: string, docId: string) =>
      `orgs/${orgId}/${platform}/users/${userId}/documents/${docId}/archived`,
    userMetadata: (orgId: string, platform: string, userId: string, docId: string) =>
      `orgs/${orgId}/${platform}/users/${userId}/metadata/${docId}`,
    /** @deprecated Use StoragePathBuilder.temp(orgId, jobId, fileName) */
    userTemp: (orgId: string, _platform: string, userId: string, jobId: string) =>
      `temp/${orgId}/${jobId}/${userId}`,
    /** @deprecated Use StoragePathBuilder.userStatute */
    userStatutes: (orgId: string, platform: string, userId: string, jurisdiction: string) =>
      `orgs/${orgId}/${platform}/users/${userId}/statutes/${jurisdiction}`,
    /** @deprecated Use StoragePathBuilder.userCompliance */
    userCompliance: (orgId: string, platform: string, userId: string, framework: string) =>
      `orgs/${orgId}/${platform}/users/${userId}/compliance/${framework}`,

    // Global / shared knowledge (lives outside per-user trees)
    /** @deprecated Use StoragePathBuilder.globalStatute */
    globalStatutes: (jurisdiction: string, statuteCode: string) =>
      `global/statutes/${jurisdiction.toLowerCase()}/${statuteCode}`,
    /** @deprecated Use StoragePathBuilder.globalCompliance */
    globalCompliance: (framework: string) =>
      `global/compliance/${framework.toLowerCase()}`,
    /** @deprecated Use StoragePathBuilder.sharedTemplate or org shared path */
    orgShared: (orgId: string, platform: string, category: string) =>
      `orgs/${orgId}/${platform}/shared/${category}`,

    /** @deprecated Use StoragePathBuilder.temp */
    temp: (orgId: string, jobId: string) =>
      `temp/${orgId}/${jobId}`,
    processingQueue: (orgId: string, jobId: string) => `temp/${orgId}/${jobId}`,
    processingInProgress: (orgId: string, jobId: string) => `temp/${orgId}/${jobId}/in-progress`,
    processingFailed: (orgId: string, jobId: string) => `temp/${orgId}/${jobId}/failed`,
    processingCompleted: (orgId: string, jobId: string) => `temp/${orgId}/${jobId}/completed`,

    /** @deprecated Use StoragePathBuilder.parsedContent */
    parsed: (orgId: string, platform: string, userId: string, docId: string) =>
      `orgs/${orgId}/${platform}/users/${userId}/parsed/${docId}/content.json`,
    /** @deprecated Use StoragePathBuilder.documentEmbeddings */
    embeddings: (orgId: string, platform: string, userId: string, docId: string) =>
      `orgs/${orgId}/${platform}/users/${userId}/embeddings/${docId}/chunks.json`,
    aiSummaries: (orgId: string, platform: string, userId: string, docId: string) =>
      `orgs/${orgId}/${platform}/users/${userId}/parsed/${docId}/summary.json`,
    aiExtracts: (orgId: string, platform: string, userId: string, docId: string) =>
      `orgs/${orgId}/${platform}/users/${userId}/parsed/${docId}/extracts.json`,
    aiOcrResults: (orgId: string, platform: string, userId: string, docId: string) =>
      `orgs/${orgId}/${platform}/users/${userId}/parsed/${docId}/ocr.json`,
    aiClassifications: (orgId: string, platform: string, userId: string, docId: string) =>
      `orgs/${orgId}/${platform}/users/${userId}/parsed/${docId}/classification.json`,

    // Models
    modelWeights: (name: string) => `models/weights/${name}`,
    modelConfigs: (name: string) => `models/configs/${name}`,

    // System
    systemLogs: (date: string, file: string) => `system/logs/${date}/${file}`,
    systemBackups: (date: string, file: string) => `system/backups/${date}/${file}`,
    systemAudit: (date: string, file: string) => `system/audit/${date}/${file}`,
  },

  // Upload constraints
  // v5.0.1 (G4 decision 2026-05-06): default raised 100 → 1024 MB per user
  // mandate. Per-tier caps (NSA=10, NYM=25, NSP=100, NSI=500, NSM=1024) live in
  // src/config/jrx-sdk-variants.ts maxDocSizeMb and are enforced by the SDK
  // gateway middleware. This constant is only the absolute platform ceiling.
  // NOTE: until D5/D6 (streamed multipart + presigned PUT) are shipped,
  // raising this introduces RAM pressure under concurrent uploads. Treat
  // 1 GB uploads as serial-only until the streaming refactor lands.
  limits: {
    maxFileSizeMb: envInt('JRX_MAX_FILE_SIZE_MB', 1024),
    maxBatchSizeMb: envInt('JRX_MAX_BATCH_SIZE_MB', 2048),
    allowedMimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/markdown',
      'text/csv',
      'text/html',
      'application/json',
      'image/jpeg',
      'image/png',
      'image/tiff',
      'image/webp',
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
      'video/mp4',
    ] as string[],
    allowedExtensions: [
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.txt', '.md', '.csv', '.html', '.json', '.rtf',
      '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp',
      '.mp3', '.wav', '.ogg', '.m4a',
      '.mp4', '.mov', '.avi',
    ] as string[],
  },

  // CDN for serving parsed/processed documents
  cdn: {
    enabled: envBool('JRX_CDN_ENABLED', false),
    baseUrl: env('JRX_CDN_BASE_URL', ''),
    cacheControl: env('JRX_CDN_CACHE_CONTROL', 'private, max-age=3600'),
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// LLM PROVIDER CONFIGURATION (April 2026)
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_LLM = {
  // Primary router — controls which provider pool is tried first
  defaultProvider: env('JRX_LLM_DEFAULT_PROVIDER', 'openrouter'),
  fallbackChain: envList('JRX_LLM_FALLBACK_CHAIN', [
    'openrouter', 'openai', 'anthropic', 'google', 'deepseek', 'meta', 'mistral', 'agentzero',
  ]),
  maxRetries: envInt('JRX_LLM_MAX_RETRIES', 3),
  timeoutMs: envInt('JRX_LLM_TIMEOUT_MS', 60_000),
  streamingTimeoutMs: envInt('JRX_LLM_STREAMING_TIMEOUT_MS', 120_000),
  maxConcurrentRequests: envInt('JRX_LLM_MAX_CONCURRENT', 50),

  // Provider API keys (JRX_ prefix standard; Replit AI fallback for dev)
  providers: {
    openrouter: {
      id: 'openrouter',
      name: 'OpenRouter',
      enabled: envBool('JRX_OPENROUTER_ENABLED', true),
      apiKey: env('JRX_OPENROUTER_API_KEY', env('OPENROUTER_API_KEY', env('AI_INTEGRATIONS_OPENROUTER_API_KEY', ''))),
      baseUrl: env('JRX_OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
      get isConfigured(): boolean { return !!this.apiKey; },
    },
    openai: {
      id: 'openai',
      name: 'OpenAI',
      enabled: envBool('JRX_OPENAI_ENABLED', true),
      apiKey: env('JRX_OPENAI_API_KEY', env('OPENAI_API_KEY', env('AI_INTEGRATIONS_OPENAI_API_KEY', ''))),
      baseUrl: env('JRX_OPENAI_BASE_URL', 'https://api.openai.com/v1'),
      get isConfigured(): boolean { return !!this.apiKey; },
    },
    anthropic: {
      id: 'anthropic',
      name: 'Anthropic',
      enabled: envBool('JRX_ANTHROPIC_ENABLED', true),
      apiKey: env('JRX_ANTHROPIC_API_KEY', env('ANTHROPIC_API_KEY', '')),
      baseUrl: env('JRX_ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
      get isConfigured(): boolean { return !!this.apiKey; },
    },
    google: {
      id: 'google',
      name: 'Google Gemini',
      enabled: envBool('JRX_GOOGLE_ENABLED', true),
      apiKey: env('JRX_GOOGLE_API_KEY', env('GOOGLE_API_KEY', env('GEMINI_API_KEY', ''))),
      baseUrl: env('JRX_GOOGLE_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'),
      get isConfigured(): boolean { return !!this.apiKey; },
    },
    deepseek: {
      id: 'deepseek',
      name: 'DeepSeek',
      enabled: envBool('JRX_DEEPSEEK_ENABLED', true),
      apiKey: env('JRX_DEEPSEEK_API_KEY', env('DEEPSEEK_API_KEY', '')),
      baseUrl: env('JRX_DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1'),
      get isConfigured(): boolean { return !!this.apiKey; },
    },
    meta: {
      id: 'meta',
      name: 'Meta Llama (via OpenRouter/Groq)',
      enabled: envBool('JRX_META_ENABLED', true),
      apiKey: env('JRX_GROQ_API_KEY', env('GROQ_API_KEY', '')),
      baseUrl: env('JRX_GROQ_BASE_URL', 'https://api.groq.com/openai/v1'),
      get isConfigured(): boolean { return !!this.apiKey; },
    },
    mistral: {
      id: 'mistral',
      name: 'Mistral AI',
      enabled: envBool('JRX_MISTRAL_ENABLED', true),
      apiKey: env('JRX_MISTRAL_API_KEY', env('MISTRAL_API_KEY', '')),
      baseUrl: env('JRX_MISTRAL_BASE_URL', 'https://api.mistral.ai/v1'),
      get isConfigured(): boolean { return !!this.apiKey; },
    },
    sarvam: {
      id: 'sarvam',
      name: 'Sarvam AI (22 Indian Languages)',
      enabled: envBool('JRX_SARVAM_ENABLED', false),
      apiKey: env('JRX_SARVAM_API_KEY', env('SARVAM_API_KEY', '')),
      baseUrl: env('JRX_SARVAM_BASE_URL', 'https://api.sarvam.ai'),
      get isConfigured(): boolean { return !!this.apiKey; },
    },
    agentzero: {
      id: 'agentzero',
      name: 'AgentZero (Always-On Fallback)',
      enabled: true,
      apiKey: 'local',
      baseUrl: 'local',
      isConfigured: true,
    },
  },

  // April 2026 current model IDs (confirmed API IDs)
  models: {
    // OpenAI
    GPT_4_1: 'gpt-4.1',
    GPT_4_1_MINI: 'gpt-4.1-mini',
    GPT_4_1_NANO: 'gpt-4.1-nano',
    O3: 'o3',
    O3_MINI: 'o3-mini',
    O3_PRO: 'o3-pro',
    O4_MINI: 'o4-mini',
    // Anthropic (hyphens — confirmed format)
    CLAUDE_OPUS_4_6: 'claude-opus-4-6',
    CLAUDE_SONNET_4_6: 'claude-sonnet-4-6',
    CLAUDE_HAIKU_4_5: 'claude-haiku-4-5',
    // Google
    GEMINI_3_1_PRO_PREVIEW: 'gemini-3.1-pro-preview',
    GEMINI_2_5_PRO: 'gemini-2.5-pro',
    GEMINI_2_5_FLASH: 'gemini-2.5-flash',
    GEMINI_2_5_FLASH_LITE: 'gemini-2.5-flash-lite',
    // DeepSeek
    DEEPSEEK_V3: 'deepseek-v3',
    DEEPSEEK_R1: 'deepseek-r1',
    DEEPSEEK_PROVER_V2: 'deepseek-prover-v2',
    // Meta Llama 4
    LLAMA_4_MAVERICK: 'llama-4-maverick',
    LLAMA_4_SCOUT: 'llama-4-scout',
    // Mistral
    MISTRAL_LARGE_2512: 'mistral-large-2512',
    DEVSTRAL_MEDIUM: 'devstral-medium',
    CODESTRAL_2508: 'codestral-2508',
    // Sarvam
    SARVAM_2B: 'sarvam-2b',
    SARVAM_M: 'sarvam-m',
    // AgentZero
    AGENTZERO: 'agentzero',
  },

  // Embedding models
  embedding: {
    default: env('JRX_EMBEDDING_MODEL', 'gemini-embedding-2'),
    dimension: envInt('JRX_EMBEDDING_DIMENSION', 1536),
    batchSize: envInt('JRX_EMBEDDING_BATCH_SIZE', 100),
    // NV-EMBEDDING-CASCADE-001: Gemini-first platform default (override via JRX_EMBEDDING_PROVIDER / JRX_EMBEDDING_CASCADE).
    provider: env('JRX_EMBEDDING_PROVIDER', 'gemini'),
  },

  // Temperature defaults by task type
  temperature: {
    legal: envFloat('JRX_TEMP_LEGAL', 0.1),
    analysis: envFloat('JRX_TEMP_ANALYSIS', 0.2),
    chat: envFloat('JRX_TEMP_CHAT', 0.5),
    creative: envFloat('JRX_TEMP_CREATIVE', 0.7),
    research: envFloat('JRX_TEMP_RESEARCH', 0.3),
    compliance: envFloat('JRX_TEMP_COMPLIANCE', 0.0),
    ocr: envFloat('JRX_TEMP_OCR', 0.0),
  },

  // Cost budget guards
  budget: {
    perRequestMaxUsd: envFloat('JRX_BUDGET_PER_REQUEST_USD', 0.25),
    dailyMaxUsd: envFloat('JRX_BUDGET_DAILY_USD', 500.0),
    monthlyMaxUsd: envFloat('JRX_BUDGET_MONTHLY_USD', 10_000.0),
  },

  // Max token limits by use case
  maxTokens: {
    chat: envInt('JRX_MAX_TOKENS_CHAT', 4096),
    analysis: envInt('JRX_MAX_TOKENS_ANALYSIS', 8192),
    document: envInt('JRX_MAX_TOKENS_DOCUMENT', 32768),
    caseBrief: envInt('JRX_MAX_TOKENS_CASE_BRIEF', 16384),
    research: envInt('JRX_MAX_TOKENS_RESEARCH', 16384),
    ocr: envInt('JRX_MAX_TOKENS_OCR', 4096),
    compliance: envInt('JRX_MAX_TOKENS_COMPLIANCE', 16384),
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// RAG PIPELINE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_RAG = {
  // Chunking
  chunkSize: envInt('JRX_RAG_CHUNK_SIZE', 800),          // tokens
  chunkOverlap: envInt('JRX_RAG_CHUNK_OVERLAP', 150),    // tokens
  maxChunksPerDoc: envInt('JRX_RAG_MAX_CHUNKS_DOC', 500),

  // Retrieval
  topK: envInt('JRX_RAG_TOP_K', 10),
  minSimilarity: envFloat('JRX_RAG_MIN_SIMILARITY', 0.72),
  hybridAlpha: envFloat('JRX_RAG_HYBRID_ALPHA', 0.65),   // 0=BM25, 1=vector, 0.65=65% vector + 35% BM25
  rerankEnabled: envBool('JRX_RAG_RERANK_ENABLED', true),
  rerankTopK: envInt('JRX_RAG_RERANK_TOP_K', 5),
  maxContextTokens: envInt('JRX_RAG_MAX_CONTEXT_TOKENS', 12_000),

  // Multi-level retrieval
  levels: {
    // Global — platform-wide statutes, compliance frameworks (all users)
    globalStatutes: { enabled: true, namespace: 'nyv:global:statutes', weight: 0.4 },
    // Org-level — shared org documents, policies (all users in org)
    orgShared: { enabled: true, namespace: 'nyv:org:shared', weight: 0.3 },
    // User-level — personal uploaded documents (per user/lawyer)
    userDocuments: { enabled: true, namespace: 'nyv:user:docs', weight: 0.3 },
  },

  // GraphRAG settings
  graphRag: {
    enabled: envBool('JRX_GRAPHRAG_ENABLED', true),
    maxHops: envInt('JRX_GRAPHRAG_MAX_HOPS', 3),
    entityTypes: ['person', 'organization', 'statute', 'case', 'court', 'jurisdiction', 'date', 'amount'],
    relationshipTypes: ['applies_to', 'amends', 'overrules', 'cites', 'defines', 'governs', 'requires'],
  },

  // Adaptive RAG routing thresholds
  routing: {
    vectorDbThreshold: envFloat('JRX_RAG_VECTOR_THRESHOLD', 0.70),
    webSearchThreshold: envFloat('JRX_RAG_WEB_THRESHOLD', 0.40),
    hybridThreshold: envFloat('JRX_RAG_HYBRID_THRESHOLD', 0.55),
    legalKnowledgeThreshold: envFloat('JRX_RAG_LEGAL_THRESHOLD', 0.85),
  },

  // Cache
  embeddingCacheTtlMs: envInt('JRX_RAG_EMBED_CACHE_TTL_MS', 86_400_000), // 24h

  // Access control
  chunkLevelRbac: envBool('JRX_RAG_CHUNK_RBAC', true), // fine-grained RBAC at chunk level
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// AGENT CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_AGENTS = {
  totalAgents: 149,
  romaLevel: 'L5',
  sdkVersion: '5.0.0',
  systemPromptVersion: 'v10.0',
  registryPath: 'config/agent-registries/Jurexio-Legal-registry-Default.json',
  practiceAreas: 29,
  jurisdictions: ['IN', 'UK', 'GCC', 'EU', 'US', 'SG'] as const,

  // ROMA L5 confidence thresholds
  confidence: {
    autoApprove: envFloat('JRX_AGENT_CONFIDENCE_AUTO', 0.95),
    requireReview: envFloat('JRX_AGENT_CONFIDENCE_REVIEW', 0.70),
    escalateToHITL: envFloat('JRX_AGENT_CONFIDENCE_ESCALATE', 0.50),
  },

  // Concurrency limits
  maxConcurrentAgents: envInt('JRX_MAX_CONCURRENT_AGENTS', 20),
  maxAgentsPerSwarm: envInt('JRX_MAX_AGENTS_SWARM', 12),
  agentTimeoutMs: envInt('JRX_AGENT_TIMEOUT_MS', 120_000),

  // GRPO settings
  grpo: {
    enabled: envBool('JRX_GRPO_ENABLED', true),
    advocateCount: envInt('JRX_GRPO_ADVOCATE_COUNT', 5),
    scoringRange: [1, 10] as [number, number],
    minScoreToAccept: envFloat('JRX_GRPO_MIN_SCORE', 6.5),
  },

  // AgentZero fallback (Level 5 — always-on)
  agentZero: {
    enabled: true,
    costPerToken: 0.0,
    maxTokens: 4096,
    basePrompt: 'You are AgentZero, the always-on fallback legal AI assistant for Jurexio. Provide best-effort legal information based on your training knowledge. Always note that responses are informational only and do not constitute legal advice. Recommend users consult a qualified lawyer for specific legal matters.',
  },

  // JRX-SLM bindings (jurisdiction → specialist model)
  slmBindings: {
    IN: 'JRX-SLM-IND',
    UK: 'JRX-SLM-UK',
    GCC: 'JRX-SLM-GCC',
    EU: 'JRX-SLM-EUR',
    US: 'JRX-SLM-USA',
    SG: 'JRX-SLM-SGP',
  } as Record<string, string>,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// VOICE TTS/STT CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_VOICE = {
  // TTS providers (priority order)
  tts: {
    providers: {
      elevenlabs: {
        id: 'elevenlabs',
        enabled: envBool('JRX_ELEVENLABS_ENABLED', true),
        apiKey: env('JRX_ELEVENLABS_API_KEY', env('ELEVENLABS_API_KEY', '')),
        baseUrl: env('JRX_ELEVENLABS_BASE_URL', 'https://api.elevenlabs.io/v1'),
        defaultVoice: env('JRX_ELEVENLABS_DEFAULT_VOICE', 'rachel'),
        defaultModel: env('JRX_ELEVENLABS_MODEL', 'eleven_multilingual_v2'),
        maxCharacters: envInt('JRX_ELEVENLABS_MAX_CHARS', 5000),
        get isConfigured(): boolean { return !!this.apiKey; },
      },
      sarvam: {
        id: 'sarvam',
        enabled: envBool('JRX_SARVAM_TTS_ENABLED', false),
        apiKey: env('JRX_SARVAM_API_KEY', env('SARVAM_API_KEY', '')),
        baseUrl: env('JRX_SARVAM_BASE_URL', 'https://api.sarvam.ai'),
        defaultVoice: env('JRX_SARVAM_TTS_VOICE', 'meera'),
        supportedLanguages: ['hi', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'bn', 'or', 'pa', 'as', 'ur'],
        get isConfigured(): boolean { return !!this.apiKey; },
      },
      openai: {
        id: 'openai-tts',
        enabled: envBool('JRX_OPENAI_TTS_ENABLED', true),
        defaultVoice: env('JRX_OPENAI_TTS_VOICE', 'nova'),
        defaultModel: env('JRX_OPENAI_TTS_MODEL', 'tts-1-hd'),
        get isConfigured(): boolean { return !!JRX_LLM.providers.openai.apiKey; },
      },
      browserTts: {
        id: 'browser-tts',
        enabled: true,
        cost: 0,
        isConfigured: true, // Always available (client-side)
      },
    },
    fallbackChain: envList('JRX_TTS_FALLBACK_CHAIN', ['elevenlabs', 'sarvam', 'openai-tts', 'browser-tts']),
    streamingEnabled: envBool('JRX_TTS_STREAMING', true),
    audioFormat: env('JRX_TTS_AUDIO_FORMAT', 'mp3'),
    sampleRate: envInt('JRX_TTS_SAMPLE_RATE', 22050),
  },

  // STT providers
  stt: {
    providers: {
      openaiWhisper: {
        id: 'openai-whisper',
        enabled: envBool('JRX_OPENAI_STT_ENABLED', true),
        model: env('JRX_OPENAI_STT_MODEL', 'whisper-1'),
        maxFileSizeMb: 25,
        supportedFormats: ['mp3', 'wav', 'ogg', 'm4a', 'webm'],
        get isConfigured(): boolean { return !!JRX_LLM.providers.openai.apiKey; },
      },
      deepgram: {
        id: 'deepgram',
        enabled: envBool('JRX_DEEPGRAM_ENABLED', false),
        apiKey: env('JRX_DEEPGRAM_API_KEY', env('DEEPGRAM_API_KEY', '')),
        baseUrl: env('JRX_DEEPGRAM_BASE_URL', 'wss://api.deepgram.com/v1/listen'),
        model: env('JRX_DEEPGRAM_MODEL', 'nova-3'),
        get isConfigured(): boolean { return !!this.apiKey; },
      },
      sarvamStt: {
        id: 'sarvam-stt',
        enabled: envBool('JRX_SARVAM_STT_ENABLED', false),
        apiKey: env('JRX_SARVAM_API_KEY', env('SARVAM_API_KEY', '')),
        supportedLanguages: ['hi', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'bn'],
        get isConfigured(): boolean { return !!this.apiKey; },
      },
    },
    fallbackChain: envList('JRX_STT_FALLBACK_CHAIN', ['gemini', 'openai-whisper', 'deepgram', 'sarvam-stt']),
    realtime: envBool('JRX_STT_REALTIME', true),
    language: env('JRX_STT_DEFAULT_LANGUAGE', 'en'),
    diarization: envBool('JRX_STT_DIARIZATION', false),
  },

  // WebSocket voice config
  ws: {
    path: '/ws/nyv/voice',
    maxSessionsPerUser: envInt('JRX_VOICE_WS_MAX_SESSIONS', 5),
    authTimeoutMs: envInt('JRX_VOICE_WS_AUTH_TIMEOUT_MS', 10_000),
    pingIntervalMs: envInt('JRX_VOICE_WS_PING_INTERVAL_MS', 30_000),
    maxMessageSizeBytes: envInt('JRX_VOICE_WS_MAX_MSG_BYTES', 10_000_000), // 10MB
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// COMMUNICATION CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_COMMS = {
  email: {
    host: env('JRX_SMTP_HOST', env('SMTP_HOST', '')),
    port: envInt('JRX_SMTP_PORT', 587),
    secure: envBool('JRX_SMTP_SECURE', false),
    user: env('JRX_SMTP_USER', env('SMTP_USER', '')),
    pass: env('JRX_SMTP_PASS', env('SMTP_PASS', '')),
    fromName: env('JRX_SMTP_FROM_NAME', 'Jurexio'),
    fromEmail: env('JRX_SMTP_FROM_EMAIL', ''),
    get isConfigured(): boolean { return !!(this.host && this.user && this.pass && this.fromEmail); },
  },

  whatsapp: {
    token: env('JRX_WHATSAPP_TOKEN', env('WHATSAPP_TOKEN', '')),
    phoneNumberId: env('JRX_WHATSAPP_PHONE_ID', env('WHATSAPP_PHONE_ID', '')),
    businessAccountId: env('JRX_WHATSAPP_BUSINESS_ID', ''),
    webhookVerifyToken: env('JRX_WHATSAPP_WEBHOOK_VERIFY', ''),
    baseUrl: 'https://graph.facebook.com/v18.0',
    get isConfigured(): boolean { return !!(this.token && this.phoneNumberId); },
  },

  sms: {
    provider: env('JRX_SMS_PROVIDER', 'twilio') as 'twilio' | 'vonage' | 'd7sms',
    twilio: {
      accountSid: env('JRX_TWILIO_ACCOUNT_SID', env('TWILIO_ACCOUNT_SID', '')),
      authToken: env('JRX_TWILIO_AUTH_TOKEN', env('TWILIO_AUTH_TOKEN', '')),
      fromNumber: env('JRX_TWILIO_FROM_NUMBER', ''),
      get isConfigured(): boolean { return !!(this.accountSid && this.authToken); },
    },
  },

  payment: {
    razorpay: {
      keyId: env('JRX_RAZORPAY_KEY_ID', env('RAZORPAY_KEY_ID', '')),
      keySecret: env('JRX_RAZORPAY_KEY_SECRET', env('RAZORPAY_KEY_SECRET', '')),
      webhookSecret: env('JRX_RAZORPAY_WEBHOOK_SECRET', ''),
      baseUrl: 'https://api.razorpay.com/v1',
      get isConfigured(): boolean { return !!(this.keyId && this.keySecret); },
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_SECURITY = {
  jwt: {
    secret: env('JRX_JWT_SECRET', env('JWT_SECRET', '')),
    refreshSecret: env('JRX_JWT_REFRESH_SECRET', env('JWT_REFRESH_SECRET', '')),
    expiryHours: envInt('JRX_JWT_EXPIRY_HOURS', 4),
    refreshExpiryDays: envInt('JRX_JWT_REFRESH_EXPIRY_DAYS', 30),
    algorithm: env('JRX_JWT_ALGORITHM', 'HS256') as 'HS256' | 'RS256' | 'ES256',
    issuer: env('JRX_JWT_ISSUER', 'jurexio-platform'),
    audience: env('JRX_JWT_AUDIENCE', 'jrx-sdk-v5'),
  },

  encryption: {
    atRest: envBool('JRX_ENCRYPTION_AT_REST', true),
    inTransit: envBool('JRX_ENCRYPTION_IN_TRANSIT', true),
    algorithm: env('JRX_ENCRYPTION_ALGO', 'AES-256-GCM'),
    keyDerivation: env('JRX_KEY_DERIVATION', 'PBKDF2'),
  },

  // Quantum-ready (post-quantum cryptography)
  quantum: {
    enabled: envBool('JRX_QUANTUM_ENABLED', false),
    kemAlgorithm: 'ML-KEM-512',    // CRYSTALS-Kyber
    signAlgorithm: 'ML-DSA-44',    // CRYSTALS-Dilithium
    zkpScheme: 'PLONK',
    bbProtocol: 'BB84',            // QKD
  },

  // Rate limiting
  rateLimits: {
    global: { windowMs: 60_000, maxRequests: envInt('JRX_RATE_LIMIT_GLOBAL', 1500) },
    llm: { windowMs: 60_000, maxRequests: envInt('JRX_RATE_LIMIT_LLM', 60) },
    auth: { windowMs: 60_000, maxRequests: envInt('JRX_RATE_LIMIT_AUTH', 10) },
    upload: { windowMs: 60_000, maxRequests: envInt('JRX_RATE_LIMIT_UPLOAD', 10) },
    sdk: { windowMs: 60_000, maxRequests: envInt('JRX_RATE_LIMIT_SDK', 300) },
  },

  // PII patterns (for all 6 jurisdictions)
  pii: {
    enabled: envBool('JRX_PII_ENABLED', true),
    autoRedact: envBool('JRX_PII_AUTO_REDACT', true),
    redactionChar: '█',
    cleanupIntervalMs: envInt('JRX_PII_CLEANUP_INTERVAL_MS', 300_000), // 5 min
    patterns: {
      aadhaar: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
      pan: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
      phone: /\b(?:\+91[\s-]?)?[6-9]\d{9}\b/g,
      email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi,
      ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
      passport: /\b[A-Z][0-9]{7}\b/g,
      creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
      ukNino: /\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/g,
      sgNric: /\b[STFG]\d{7}[A-Z]\b/g,
      uaeId: /\b784-\d{4}-\d{7}-\d\b/g,
    },
  },

  // CORS
  cors: {
    get origins(): string[] {
      if (process.env.CORS_ORIGINS) return process.env.CORS_ORIGINS.split(',').map(s => s.trim());
      if (process.env.JRX_DEV_DOMAIN) {
        const d = process.env.JRX_DEV_DOMAIN;
        return [`https://${d}`, 'http://localhost:5000', 'http://localhost:3004'];
      }
      return ['*'];
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID', 'X-Organization-ID', 'X-Jurisdiction'] as const,
    maxAgeSeconds: envInt('JRX_CORS_MAX_AGE', 86400),
  },

  // SDK API key format
  apiKey: {
    prefix: 'nyv_',
    length: envInt('JRX_API_KEY_LENGTH', 48),
    algorithm: 'sha256',
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// JURISDICTION CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_JURISDICTIONS = {
  IN: {
    code: 'IN', name: 'India', slmBinding: 'JRX-SLM-IND',
    dataResidency: 'ap-south-1',
    defaultLang: 'en', supportedLangs: ['hi', 'en', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'bn', 'or', 'pa', 'as', 'ur'],
    complianceFrameworks: ['DPDP Act 2023', 'IT Act 2000', 'RBI Guidelines', 'SEBI Regulations'],
    piiFields: ['aadhaar', 'pan', 'phone', 'email', 'passport'],
    dataRetentionDays: 2555,
    breachNotificationHours: 72,
  },
  UK: {
    code: 'UK', name: 'United Kingdom', slmBinding: 'JRX-SLM-UK',
    dataResidency: 'eu-west-2',
    defaultLang: 'en', supportedLangs: ['en', 'cy', 'gd'],
    complianceFrameworks: ['UK GDPR', 'Data Protection Act 2018', 'FCA Regulations'],
    piiFields: ['ukNino', 'phone', 'email', 'passport'],
    dataRetentionDays: 2555,
    breachNotificationHours: 72,
  },
  GCC: {
    code: 'GCC', name: 'Gulf Cooperation Council', slmBinding: 'JRX-SLM-GCC',
    dataResidency: 'me-south-1',
    defaultLang: 'ar', supportedLangs: ['ar', 'en'],
    complianceFrameworks: ['UAE PDPL 2021', 'DIFC DPL', 'Saudi PDPL 2022', 'NCA Cybersecurity'],
    piiFields: ['uaeId', 'phone', 'email', 'passport'],
    dataRetentionDays: 1825,
    breachNotificationHours: 72,
  },
  EU: {
    code: 'EU', name: 'European Union', slmBinding: 'JRX-SLM-EUR',
    dataResidency: 'eu-central-1',
    defaultLang: 'en', supportedLangs: ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'sv'],
    complianceFrameworks: ['GDPR', 'ePrivacy', 'Digital Services Act', 'EU AI Act', 'NIS2'],
    piiFields: ['phone', 'email', 'passport', 'creditCard'],
    dataRetentionDays: 1825,
    breachNotificationHours: 72,
  },
  US: {
    code: 'US', name: 'United States', slmBinding: 'JRX-SLM-USA',
    dataResidency: 'us-east-1',
    defaultLang: 'en', supportedLangs: ['en', 'es'],
    complianceFrameworks: ['CCPA/CPRA', 'HIPAA', 'SOX', 'GLBA', 'FCPA'],
    piiFields: ['ssn', 'phone', 'email', 'creditCard', 'passport'],
    dataRetentionDays: 2555,
    breachNotificationHours: 72,
  },
  SG: {
    code: 'SG', name: 'Singapore', slmBinding: 'JRX-SLM-SGP',
    dataResidency: 'ap-southeast-1',
    defaultLang: 'en', supportedLangs: ['en', 'zh', 'ms', 'ta'],
    complianceFrameworks: ['PDPA 2012', 'Cybersecurity Act 2018', 'Computer Misuse Act'],
    piiFields: ['sgNric', 'phone', 'email', 'passport'],
    dataRetentionDays: 1825,
    breachNotificationHours: 72,
  },
} as const;

export type JurisdictionCode = keyof typeof JRX_JURISDICTIONS;

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY / TELEMETRY
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_OBSERVABILITY = {
  logging: {
    level: env('JRX_LOG_LEVEL', process.env.NODE_ENV === 'production' ? 'info' : 'debug') as 'debug' | 'info' | 'warn' | 'error',
    format: env('JRX_LOG_FORMAT', 'json') as 'json' | 'pretty',
    includeTraceId: envBool('JRX_LOG_TRACE_ID', true),
    maskSecrets: envBool('JRX_LOG_MASK_SECRETS', true),
  },

  metrics: {
    enabled: envBool('JRX_METRICS_ENABLED', true),
    provider: env('JRX_METRICS_PROVIDER', 'prometheus') as 'prometheus' | 'datadog' | 'cloudwatch',
    endpoint: env('JRX_METRICS_ENDPOINT', '/metrics'),
    collectIntervalMs: envInt('JRX_METRICS_INTERVAL_MS', 30_000),
  },

  tracing: {
    enabled: envBool('JRX_TRACING_ENABLED', false),
    provider: env('JRX_TRACING_PROVIDER', 'opentelemetry'),
    endpoint: env('JRX_OTEL_ENDPOINT', ''),
    serviceName: 'jrx-gateway',
    serviceVersion: JRX_PLATFORM_VERSION,
  },

  sentry: {
    dsn: env('JRX_SENTRY_DSN', env('SENTRY_DSN', '')),
    environment: env('NODE_ENV', 'development'),
    tracesSampleRate: envFloat('JRX_SENTRY_SAMPLE_RATE', 0.1),
    get isConfigured(): boolean { return !!this.dsn; },
  },

  healthCheck: {
    path: '/api/jrx/health',
    fullPath: '/api/jrx/health/full',
    timeoutMs: envInt('JRX_HEALTH_TIMEOUT_MS', 10_000),
    cacheTtlMs: envInt('JRX_HEALTH_CACHE_TTL_MS', 30_000),
  },

  // Audit trail
  audit: {
    enabled: envBool('JRX_AUDIT_ENABLED', true),
    retentionDays: envInt('JRX_AUDIT_RETENTION_DAYS', 2555), // 7 years
    includeRequestBody: envBool('JRX_AUDIT_INCLUDE_BODY', false),
    sensitiveHeaders: ['Authorization', 'X-API-Key', 'Cookie'],
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE FLAGS (Runtime toggleable)
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_FEATURES = {
  // AI & Agents
  agentOrchestration: envBool('JRX_FEATURE_AGENTS', true),
  romaL5: envBool('JRX_FEATURE_ROMA_L5', true),
  grpo: envBool('JRX_FEATURE_GRPO', true),
  swarmTopologies: envBool('JRX_FEATURE_SWARM', true),
  hitl: envBool('JRX_FEATURE_HITL', true),
  digitalTwin: envBool('JRX_FEATURE_DIGITAL_TWIN', false),
  skillsSystem: envBool('JRX_FEATURE_SKILLS', true),

  // Document Intelligence
  ocr: envBool('JRX_FEATURE_OCR', true),
  documentConversion: envBool('JRX_FEATURE_DOC_CONVERT', true),
  clm: envBool('JRX_FEATURE_CLM', true),
  eFiling: envBool('JRX_FEATURE_EFILING', false), // requires court API keys

  // RAG & Knowledge
  graphRag: envBool('JRX_FEATURE_GRAPHRAG', true),
  adaptiveRag: envBool('JRX_FEATURE_ADAPTIVE_RAG', true),
  hybridSearch: envBool('JRX_FEATURE_HYBRID_SEARCH', true),
  semanticCache: envBool('JRX_FEATURE_SEMANTIC_CACHE', true),

  // Communication
  voiceInterface: envBool('JRX_FEATURE_VOICE', true),
  whatsApp: envBool('JRX_FEATURE_WHATSAPP', true),
  emailAutomation: envBool('JRX_FEATURE_EMAIL', true),
  smsAutomation: envBool('JRX_FEATURE_SMS', false),

  // Multimodal
  visionOcr: envBool('JRX_FEATURE_VISION', true),
  videoGeneration: envBool('JRX_FEATURE_VIDEO', false),
  avatarInterface: envBool('JRX_FEATURE_AVATAR', false),

  // Security
  quantumSecurity: envBool('JRX_FEATURE_QUANTUM', false),
  piiVault: envBool('JRX_FEATURE_PII_VAULT', true),
  hashChainAudit: envBool('JRX_FEATURE_HASH_CHAIN', true),
  biasDetection: envBool('JRX_FEATURE_BIAS_DETECT', true),

  // Platform
  multiLanguage: envBool('JRX_FEATURE_I18N', true),
  whiteLabel: envBool('JRX_FEATURE_WHITE_LABEL', true),
  paymentProcessing: envBool('JRX_FEATURE_PAYMENTS', !!process.env.JRX_RAZORPAY_KEY_ID),
  sdkAnalytics: envBool('JRX_FEATURE_SDK_ANALYTICS', true),

  // Kill switch
  aiGlobal: envBool('JRX_AI_GLOBAL_ENABLED', true),
  maxConcurrentAiRequests: envInt('JRX_AI_MAX_CONCURRENT', 50),
  emergencyShutdownCode: env('JRX_AI_EMERGENCY_CODE', ''),
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION PLUGIN CONFIGURATION
// (see jrx-integration-plugin-manager.ts for plugin registry)
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_INTEGRATIONS = {
  // Third-party integrations — enable/disable per deployment
  enabled: envList('JRX_INTEGRATIONS_ENABLED', [
    'openai', 'anthropic', 'google', 'deepseek', 'sarvam', 'elevenlabs',
    'razorpay', 'email', 'whatsapp',
  ]),

  // Webhook settings for incoming events from 3rd party systems
  webhooks: {
    secret: env('JRX_WEBHOOK_SECRET', ''),
    timeoutMs: envInt('JRX_WEBHOOK_TIMEOUT_MS', 30_000),
    maxPayloadBytes: envInt('JRX_WEBHOOK_MAX_PAYLOAD_BYTES', 1_000_000),
    signatureHeader: 'X-JRX-Signature',
    timestampHeader: 'X-JRX-Timestamp',
    allowedSkewMs: envInt('JRX_WEBHOOK_ALLOWED_SKEW_MS', 300_000), // 5 min
  },

  // Plugin registry path (loaded at startup)
  pluginRegistryPath: env('JRX_PLUGIN_REGISTRY_PATH', 'src/integrations'),
  pluginAutoLoad: envBool('JRX_PLUGIN_AUTOLOAD', true),
  pluginTimeout: envInt('JRX_PLUGIN_TIMEOUT_MS', 10_000),
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// DATA GOVERNANCE / RETENTION
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_GOVERNANCE = {
  retention: {
    enabled: envBool('JRX_RETENTION_ENABLED', true),
    runScheduleHours: envInt('JRX_RETENTION_SCHEDULE_HOURS', 24),
    policies: {
      activeCaseDays: envInt('JRX_RETAIN_ACTIVE_CASE_DAYS', 365),
      closedCaseDays: envInt('JRX_RETAIN_CLOSED_CASE_DAYS', 2555),
      auditLogDays: envInt('JRX_RETAIN_AUDIT_LOG_DAYS', 2555),
      sessionLogDays: envInt('JRX_RETAIN_SESSION_LOG_DAYS', 90),
      deletedUserDataDays: envInt('JRX_RETAIN_DELETED_USER_DAYS', 30),
      tempFilesDays: envInt('JRX_RETAIN_TEMP_FILES_DAYS', 7),
      embeddingsCacheDays: envInt('JRX_RETAIN_EMBEDDINGS_DAYS', 365),
    },
  },
  erasure: {
    cascadeDelete: true,
    anonymizeInstead: envBool('JRX_ERASURE_ANONYMIZE', false),
    retainAuditTrail: true,
    cooldownHours: envInt('JRX_ERASURE_COOLDOWN_HOURS', 48),
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// MASTER EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export const JRX_CONFIG = {
  platform: JRX_PLATFORM,
  nysPlaftorms: JRX_ECOSYSTEM_PLATFORMS,
  database: JRX_DATABASE,
  cache: JRX_CACHE,
  storage: JRX_STORAGE,
  llm: JRX_LLM,
  rag: JRX_RAG,
  agents: JRX_AGENTS,
  voice: JRX_VOICE,
  comms: JRX_COMMS,
  security: JRX_SECURITY,
  jurisdictions: JRX_JURISDICTIONS,
  observability: JRX_OBSERVABILITY,
  features: JRX_FEATURES,
  integrations: JRX_INTEGRATIONS,
  governance: JRX_GOVERNANCE,
} as const;

export type JRXConfig = typeof JRX_CONFIG;
export default JRX_CONFIG;
