/**
 * NYV MASTER CONFIG v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for ALL Jurexio Enterprise Platform configuration.
 * Every environment variable, feature flag, provider setting, and runtime
 * tunable lives here. Import from this file, never from scattered env reads.
 *
 * Naming convention:
 *   NYV_* env vars  → Jurexio Enterprise Platform (this SDK)
 *   NYS_* env vars  → Jurexio ecosystem overrides
 *
 * Usage:
 *   import { NYV_CONFIG } from '../config/nyv-master-config.js';
 *   const key = NYV_CONFIG.llm.providers.openai.apiKey;
 *
 * @module nyv-master-config
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

// ─── Single source of truth for platform version (NYV-AUDIT 2026-05-05) ──────
export const NYV_PLATFORM_VERSION = '5.0.0';
export const NYV_SDK_VERSION = '5.0.0';

export const NYV_PLATFORM = {
  name: 'Jurexio',
  fullName: 'Jurexio Enterprise Platform',
  prefix: 'NYV',
  version: NYV_PLATFORM_VERSION,
  sdkVersion: NYV_SDK_VERSION,
  sdkName: 'NYV SDK',
  tagline: "India's Sovereign Legal AI Operating System",
  ecosystem: 'Jurexio',
  ecosystemPrefix: 'NYS',
  gatewayPort: envInt('PORT', 5000),
  consolePort: envInt('NYV_CONSOLE_PORT', 3004),
  baseApiPath: '/api/nyv',
  wsBasePath: '/ws/nyv',
  demo: {
    email: process.env.NYV_DEMO_EMAIL ?? '',
    password: process.env.NYV_DEMO_PASSWORD ?? '',
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// NYS PLATFORM REGISTRY (5 Consumer Platforms)
// ─────────────────────────────────────────────────────────────────────────────

export const NYS_PLATFORMS = {
  NYM: {
    code: 'NYM',
    name: 'Nyayamitra™',
    fullName: 'Nyayamitra™',
    audience: 'Citizens',
    apiPath: '/api/nys/nym',
    dbPrefix: 'nym_',
    sdkClientId: 'nyv_app_nyayamitra_consumer_intake_v1',
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
  'NYS-PRO': {
    code: 'NYS-PRO',
    name: 'Jurexio Professional™',
    fullName: 'Jurexio Professional™',
    audience: 'Lawyers & Law Firms',
    apiPath: '/api/nys/pro',
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
  'NYS-INS': {
    code: 'NYS-INS',
    name: 'Jurexio Institutional™',
    fullName: 'Jurexio Institutional™',
    audience: 'Enterprise & Large Law Firms',
    apiPath: '/api/nys/ins',
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
  'NYS-ACE': {
    code: 'NYS-ACE',
    name: 'Jurexio Academy™',
    fullName: 'Jurexio Academy™',
    audience: 'Law Students & Professionals',
    apiPath: '/api/nys/ace',
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
  'NYS-MIN': {
    code: 'NYS-MIN',
    name: 'Jurexio Ministry™',
    fullName: 'Jurexio Ministry™',
    audience: 'Government & Ministries',
    apiPath: '/api/nys/gov',
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

export type NYSPlatformCode = keyof typeof NYS_PLATFORMS;

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const NYV_DATABASE = {
  // Primary connection (Neon serverless)
  url: env('DATABASE_URL', env('NYV_DATABASE_URL', '')),
  poolMin: envInt('NYV_DB_POOL_MIN', 2),
  poolMax: envInt('NYV_DB_POOL_MAX', 20),
  idleTimeoutMs: envInt('NYV_DB_IDLE_TIMEOUT_MS', 30_000),
  connectTimeoutMs: envInt('NYV_DB_CONNECT_TIMEOUT_MS', 10_000),
  statementTimeoutMs: envInt('NYV_DB_STATEMENT_TIMEOUT_MS', 60_000),
  ssl: envBool('NYV_DB_SSL', true),

  // Schema namespaces (canonical — use NYV/NYS prefixes)
  schemas: {
    nyv: 'nyv_schema',    // Jurexio platform tables (nyv_*)
    nys: 'nys_schema',    // Jurexio ecosystem tables (nys_*)
    drizzle: 'drizzle',   // Drizzle migration tracking
    public: 'public',     // Default PostgreSQL
  },

  // Read replica for analytics (optional)
  readReplicaUrl: env('NYV_DB_READ_REPLICA_URL', ''),

  // Vector extension
  pgvectorEnabled: envBool('NYV_PGVECTOR_ENABLED', true),
  vectorDimension: envInt('NYV_VECTOR_DIMENSION', 1536), // text-embedding-3-small default

  // Job queue
  jobQueues: ['nyv-ai', 'nyv-documents', 'nyv-compliance', 'nyv-default'] as const,
  jobPollIntervalMs: envInt('NYV_JOB_POLL_INTERVAL_MS', 5_000),
  jobLockTimeoutMs: envInt('NYV_JOB_LOCK_TIMEOUT_MS', 300_000),
  jobMaxBatchSize: envInt('NYV_JOB_MAX_BATCH_SIZE', 10),
  jobMaxRetries: envInt('NYV_JOB_MAX_RETRIES', 3),
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// REDIS / CACHE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const NYV_CACHE = {
  redisUrl: env('NYV_REDIS_URL', env('REDIS_URL', '')),
  redisPassword: env('NYV_REDIS_PASSWORD', env('REDIS_PASSWORD', '')),
  redisTls: envBool('NYV_REDIS_TLS', false),
  maxReconnectAttempts: envInt('NYV_REDIS_RECONNECT_ATTEMPTS', 10),
  reconnectDelayMs: envInt('NYV_REDIS_RECONNECT_DELAY_MS', 1_000),
  get isRedisConfigured(): boolean { return !!this.redisUrl; },

  // In-memory LRU fallback (per-pod, not shared)
  lruMaxSize: envInt('NYV_LRU_MAX_SIZE', 2000),

  // TTL policies (milliseconds)
  ttl: {
    semanticCache: envInt('NYV_TTL_SEMANTIC_CACHE_MS', 300_000),        // 5 min hot
    semanticCacheWarm: envInt('NYV_TTL_SEMANTIC_WARM_MS', 3_600_000),   // 1 hour warm
    semanticCacheCold: envInt('NYV_TTL_SEMANTIC_COLD_MS', 86_400_000),  // 24 hours cold
    rateLimitWindow: envInt('NYV_TTL_RATE_LIMIT_MS', 60_000),           // 1 min
    session: envInt('NYV_TTL_SESSION_MS', 14_400_000),                   // 4 hours
    statuteQuery: envInt('NYV_TTL_STATUTE_MS', 3_600_000),              // 1 hour
    mcpToolIdempotent: envInt('NYV_TTL_MCP_TOOL_MS', 300_000),         // 5 min
    agentCapabilities: envInt('NYV_TTL_AGENT_CAP_MS', 900_000),        // 15 min
    ragEmbedding: envInt('NYV_TTL_RAG_EMBED_MS', 86_400_000),          // 24 hours
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
 *   1. S3-compatible (production) — NYV_STORAGE_BACKEND=s3
 *   2. GCS (Google Cloud) — NYV_STORAGE_BACKEND=gcs
 *   3. Local filesystem — NYV_STORAGE_BACKEND=local (dev fallback)
 *
 * Document path structure (per-user/per-lawyer):
 *   {bucket}/{orgId}/{platform}/{userId}/documents/{docId}/{fileName}
 *   {bucket}/{orgId}/{platform}/{userId}/statutes/{jurisdiction}/{fileName}
 *   {bucket}/{orgId}/{platform}/{userId}/compliance/{framework}/{fileName}
 *   {bucket}/global/statutes/{jurisdiction}/{statuteCode}/{fileName}
 */

export type StorageBackend = 's3' | 'gcs' | 'local';

function detectStorageBackend(): StorageBackend {
  const explicit = env('NYV_STORAGE_BACKEND', '');
  if (explicit) {
    // Silently map legacy 'replit' to 'local' (no Replit storage in Cursor/AWS stacks).
    if (explicit === 'replit') return 'local';
    return explicit as StorageBackend;
  }
  // AWS / Cursor Cloud production: when an S3 bucket is configured, use it.
  if (env('NYV_S3_BUCKET', '') || env('AWS_S3_BUCKET', '')) return 's3';
  // Safe local fallback for dev / misconfigured envs so document jobs fail-soft.
  return 'local';
}

export const NYV_STORAGE = {
  backend: detectStorageBackend(),

  // S3 / S3-compatible (MinIO, DigitalOcean Spaces, Cloudflare R2, etc.)
  s3: {
    bucket: env('NYV_S3_BUCKET', 'nyv-documents'),
    region: env('NYV_S3_REGION', 'ap-south-1'),     // Mumbai for India-first
    accessKeyId: env('NYV_S3_ACCESS_KEY_ID', env('AWS_ACCESS_KEY_ID', '')),
    secretAccessKey: env('NYV_S3_SECRET_ACCESS_KEY', env('AWS_SECRET_ACCESS_KEY', '')),
    endpoint: env('NYV_S3_ENDPOINT', ''),            // empty = AWS S3; set for custom
    forcePathStyle: envBool('NYV_S3_FORCE_PATH_STYLE', false),
    signedUrlExpirySeconds: envInt('NYV_S3_SIGNED_URL_EXPIRY', 3600),
    serverSideEncryption: env('NYV_S3_SSE', 'AES256'),
    multipartThresholdMb: envInt('NYV_S3_MULTIPART_THRESHOLD_MB', 50),
    multipartChunkMb: envInt('NYV_S3_MULTIPART_CHUNK_MB', 10),
    get isConfigured(): boolean { return !!(this.accessKeyId && this.secretAccessKey); },
  },

  // Google Cloud Storage
  gcs: {
    bucket: env('NYV_GCS_BUCKET', 'nyv-documents'),
    projectId: env('NYV_GCS_PROJECT_ID', ''),
    keyFilePath: env('NYV_GCS_KEY_FILE', ''),
    signedUrlExpirySeconds: envInt('NYV_GCS_SIGNED_URL_EXPIRY', 3600),
    get isConfigured(): boolean { return !!(this.projectId && this.keyFilePath); },
  },

  // Local filesystem (dev only)
  local: {
    basePath: env('NYV_LOCAL_STORAGE_PATH', './uploads/nyv-documents'),
    tempPath: env('NYV_LOCAL_TEMP_PATH', './uploads/nyv-temp'),
  },

  // Storage path templates — DEPRECATED for runtime uploads.
  // SSoT: StoragePathBuilder in src/services/nyv-document-storage-service.ts
  // (orgs/{orgId}/{platform}/users/{userId}/documents/{docId}/{fileName}, etc.).
  // These legacy helpers remain for nyv-sdk-production-config.ts compatibility only;
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
    maxFileSizeMb: envInt('NYV_MAX_FILE_SIZE_MB', 1024),
    maxBatchSizeMb: envInt('NYV_MAX_BATCH_SIZE_MB', 2048),
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
    enabled: envBool('NYV_CDN_ENABLED', false),
    baseUrl: env('NYV_CDN_BASE_URL', ''),
    cacheControl: env('NYV_CDN_CACHE_CONTROL', 'private, max-age=3600'),
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// LLM PROVIDER CONFIGURATION (April 2026)
// ─────────────────────────────────────────────────────────────────────────────

export const NYV_LLM = {
  // Primary router — controls which provider pool is tried first
  defaultProvider: env('NYV_LLM_DEFAULT_PROVIDER', 'openrouter'),
  fallbackChain: envList('NYV_LLM_FALLBACK_CHAIN', [
    'openrouter', 'openai', 'anthropic', 'google', 'deepseek', 'meta', 'mistral', 'agentzero',
  ]),
  maxRetries: envInt('NYV_LLM_MAX_RETRIES', 3),
  timeoutMs: envInt('NYV_LLM_TIMEOUT_MS', 60_000),
  streamingTimeoutMs: envInt('NYV_LLM_STREAMING_TIMEOUT_MS', 120_000),
  maxConcurrentRequests: envInt('NYV_LLM_MAX_CONCURRENT', 50),

  // Provider API keys (NYV_ prefix standard; Replit AI fallback for dev)
  providers: {
    openrouter: {
      id: 'openrouter',
      name: 'OpenRouter',
      enabled: envBool('NYV_OPENROUTER_ENABLED', true),
      apiKey: env('NYV_OPENROUTER_API_KEY', env('OPENROUTER_API_KEY', env('AI_INTEGRATIONS_OPENROUTER_API_KEY', ''))),
      baseUrl: env('NYV_OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
      get isConfigured(): boolean { return !!this.apiKey; },
    },
    openai: {
      id: 'openai',
      name: 'OpenAI',
      enabled: envBool('NYV_OPENAI_ENABLED', true),
      apiKey: env('NYV_OPENAI_API_KEY', env('OPENAI_API_KEY', env('AI_INTEGRATIONS_OPENAI_API_KEY', ''))),
      baseUrl: env('NYV_OPENAI_BASE_URL', 'https://api.openai.com/v1'),
      get isConfigured(): boolean { return !!this.apiKey; },
    },
    anthropic: {
      id: 'anthropic',
      name: 'Anthropic',
      enabled: envBool('NYV_ANTHROPIC_ENABLED', true),
      apiKey: env('NYV_ANTHROPIC_API_KEY', env('ANTHROPIC_API_KEY', '')),
      baseUrl: env('NYV_ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
      get isConfigured(): boolean { return !!this.apiKey; },
    },
    google: {
      id: 'google',
      name: 'Google Gemini',
      enabled: envBool('NYV_GOOGLE_ENABLED', true),
      apiKey: env('NYV_GOOGLE_API_KEY', env('GOOGLE_API_KEY', env('GEMINI_API_KEY', ''))),
      baseUrl: env('NYV_GOOGLE_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'),
      get isConfigured(): boolean { return !!this.apiKey; },
    },
    deepseek: {
      id: 'deepseek',
      name: 'DeepSeek',
      enabled: envBool('NYV_DEEPSEEK_ENABLED', true),
      apiKey: env('NYV_DEEPSEEK_API_KEY', env('DEEPSEEK_API_KEY', '')),
      baseUrl: env('NYV_DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1'),
      get isConfigured(): boolean { return !!this.apiKey; },
    },
    meta: {
      id: 'meta',
      name: 'Meta Llama (via OpenRouter/Groq)',
      enabled: envBool('NYV_META_ENABLED', true),
      apiKey: env('NYV_GROQ_API_KEY', env('GROQ_API_KEY', '')),
      baseUrl: env('NYV_GROQ_BASE_URL', 'https://api.groq.com/openai/v1'),
      get isConfigured(): boolean { return !!this.apiKey; },
    },
    mistral: {
      id: 'mistral',
      name: 'Mistral AI',
      enabled: envBool('NYV_MISTRAL_ENABLED', true),
      apiKey: env('NYV_MISTRAL_API_KEY', env('MISTRAL_API_KEY', '')),
      baseUrl: env('NYV_MISTRAL_BASE_URL', 'https://api.mistral.ai/v1'),
      get isConfigured(): boolean { return !!this.apiKey; },
    },
    sarvam: {
      id: 'sarvam',
      name: 'Sarvam AI (22 Indian Languages)',
      enabled: envBool('NYV_SARVAM_ENABLED', false),
      apiKey: env('NYV_SARVAM_API_KEY', env('SARVAM_API_KEY', '')),
      baseUrl: env('NYV_SARVAM_BASE_URL', 'https://api.sarvam.ai'),
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
    default: env('NYV_EMBEDDING_MODEL', 'gemini-embedding-2'),
    dimension: envInt('NYV_EMBEDDING_DIMENSION', 1536),
    batchSize: envInt('NYV_EMBEDDING_BATCH_SIZE', 100),
    // NV-EMBEDDING-CASCADE-001: Gemini-first platform default (override via NYV_EMBEDDING_PROVIDER / NYV_EMBEDDING_CASCADE).
    provider: env('NYV_EMBEDDING_PROVIDER', 'gemini'),
  },

  // Temperature defaults by task type
  temperature: {
    legal: envFloat('NYV_TEMP_LEGAL', 0.1),
    analysis: envFloat('NYV_TEMP_ANALYSIS', 0.2),
    chat: envFloat('NYV_TEMP_CHAT', 0.5),
    creative: envFloat('NYV_TEMP_CREATIVE', 0.7),
    research: envFloat('NYV_TEMP_RESEARCH', 0.3),
    compliance: envFloat('NYV_TEMP_COMPLIANCE', 0.0),
    ocr: envFloat('NYV_TEMP_OCR', 0.0),
  },

  // Cost budget guards
  budget: {
    perRequestMaxUsd: envFloat('NYV_BUDGET_PER_REQUEST_USD', 0.25),
    dailyMaxUsd: envFloat('NYV_BUDGET_DAILY_USD', 500.0),
    monthlyMaxUsd: envFloat('NYV_BUDGET_MONTHLY_USD', 10_000.0),
  },

  // Max token limits by use case
  maxTokens: {
    chat: envInt('NYV_MAX_TOKENS_CHAT', 4096),
    analysis: envInt('NYV_MAX_TOKENS_ANALYSIS', 8192),
    document: envInt('NYV_MAX_TOKENS_DOCUMENT', 32768),
    caseBrief: envInt('NYV_MAX_TOKENS_CASE_BRIEF', 16384),
    research: envInt('NYV_MAX_TOKENS_RESEARCH', 16384),
    ocr: envInt('NYV_MAX_TOKENS_OCR', 4096),
    compliance: envInt('NYV_MAX_TOKENS_COMPLIANCE', 16384),
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// RAG PIPELINE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const NYV_RAG = {
  // Chunking
  chunkSize: envInt('NYV_RAG_CHUNK_SIZE', 800),          // tokens
  chunkOverlap: envInt('NYV_RAG_CHUNK_OVERLAP', 150),    // tokens
  maxChunksPerDoc: envInt('NYV_RAG_MAX_CHUNKS_DOC', 500),

  // Retrieval
  topK: envInt('NYV_RAG_TOP_K', 10),
  minSimilarity: envFloat('NYV_RAG_MIN_SIMILARITY', 0.72),
  hybridAlpha: envFloat('NYV_RAG_HYBRID_ALPHA', 0.65),   // 0=BM25, 1=vector, 0.65=65% vector + 35% BM25
  rerankEnabled: envBool('NYV_RAG_RERANK_ENABLED', true),
  rerankTopK: envInt('NYV_RAG_RERANK_TOP_K', 5),
  maxContextTokens: envInt('NYV_RAG_MAX_CONTEXT_TOKENS', 12_000),

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
    enabled: envBool('NYV_GRAPHRAG_ENABLED', true),
    maxHops: envInt('NYV_GRAPHRAG_MAX_HOPS', 3),
    entityTypes: ['person', 'organization', 'statute', 'case', 'court', 'jurisdiction', 'date', 'amount'],
    relationshipTypes: ['applies_to', 'amends', 'overrules', 'cites', 'defines', 'governs', 'requires'],
  },

  // Adaptive RAG routing thresholds
  routing: {
    vectorDbThreshold: envFloat('NYV_RAG_VECTOR_THRESHOLD', 0.70),
    webSearchThreshold: envFloat('NYV_RAG_WEB_THRESHOLD', 0.40),
    hybridThreshold: envFloat('NYV_RAG_HYBRID_THRESHOLD', 0.55),
    legalKnowledgeThreshold: envFloat('NYV_RAG_LEGAL_THRESHOLD', 0.85),
  },

  // Cache
  embeddingCacheTtlMs: envInt('NYV_RAG_EMBED_CACHE_TTL_MS', 86_400_000), // 24h

  // Access control
  chunkLevelRbac: envBool('NYV_RAG_CHUNK_RBAC', true), // fine-grained RBAC at chunk level
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// AGENT CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const NYV_AGENTS = {
  totalAgents: 149,
  romaLevel: 'L5',
  sdkVersion: '5.0.0',
  systemPromptVersion: 'v10.0',
  registryPath: 'config/agent-registries/Jurexio-Legal-registry-Default.json',
  practiceAreas: 29,
  jurisdictions: ['IN', 'UK', 'GCC', 'EU', 'US', 'SG'] as const,

  // ROMA L5 confidence thresholds
  confidence: {
    autoApprove: envFloat('NYV_AGENT_CONFIDENCE_AUTO', 0.95),
    requireReview: envFloat('NYV_AGENT_CONFIDENCE_REVIEW', 0.70),
    escalateToHITL: envFloat('NYV_AGENT_CONFIDENCE_ESCALATE', 0.50),
  },

  // Concurrency limits
  maxConcurrentAgents: envInt('NYV_MAX_CONCURRENT_AGENTS', 20),
  maxAgentsPerSwarm: envInt('NYV_MAX_AGENTS_SWARM', 12),
  agentTimeoutMs: envInt('NYV_AGENT_TIMEOUT_MS', 120_000),

  // GRPO settings
  grpo: {
    enabled: envBool('NYV_GRPO_ENABLED', true),
    advocateCount: envInt('NYV_GRPO_ADVOCATE_COUNT', 5),
    scoringRange: [1, 10] as [number, number],
    minScoreToAccept: envFloat('NYV_GRPO_MIN_SCORE', 6.5),
  },

  // AgentZero fallback (Level 5 — always-on)
  agentZero: {
    enabled: true,
    costPerToken: 0.0,
    maxTokens: 4096,
    basePrompt: 'You are AgentZero, the always-on fallback legal AI assistant for Jurexio. Provide best-effort legal information based on your training knowledge. Always note that responses are informational only and do not constitute legal advice. Recommend users consult a qualified lawyer for specific legal matters.',
  },

  // NYS-SLM bindings (jurisdiction → specialist model)
  slmBindings: {
    IN: 'NYS-SLM-IND',
    UK: 'NYS-SLM-UK',
    GCC: 'NYS-SLM-GCC',
    EU: 'NYS-SLM-EUR',
    US: 'NYS-SLM-USA',
    SG: 'NYS-SLM-SGP',
  } as Record<string, string>,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// VOICE TTS/STT CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const NYV_VOICE = {
  // TTS providers (priority order)
  tts: {
    providers: {
      elevenlabs: {
        id: 'elevenlabs',
        enabled: envBool('NYV_ELEVENLABS_ENABLED', true),
        apiKey: env('NYV_ELEVENLABS_API_KEY', env('ELEVENLABS_API_KEY', '')),
        baseUrl: env('NYV_ELEVENLABS_BASE_URL', 'https://api.elevenlabs.io/v1'),
        defaultVoice: env('NYV_ELEVENLABS_DEFAULT_VOICE', 'rachel'),
        defaultModel: env('NYV_ELEVENLABS_MODEL', 'eleven_multilingual_v2'),
        maxCharacters: envInt('NYV_ELEVENLABS_MAX_CHARS', 5000),
        get isConfigured(): boolean { return !!this.apiKey; },
      },
      sarvam: {
        id: 'sarvam',
        enabled: envBool('NYV_SARVAM_TTS_ENABLED', false),
        apiKey: env('NYV_SARVAM_API_KEY', env('SARVAM_API_KEY', '')),
        baseUrl: env('NYV_SARVAM_BASE_URL', 'https://api.sarvam.ai'),
        defaultVoice: env('NYV_SARVAM_TTS_VOICE', 'meera'),
        supportedLanguages: ['hi', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'bn', 'or', 'pa', 'as', 'ur'],
        get isConfigured(): boolean { return !!this.apiKey; },
      },
      openai: {
        id: 'openai-tts',
        enabled: envBool('NYV_OPENAI_TTS_ENABLED', true),
        defaultVoice: env('NYV_OPENAI_TTS_VOICE', 'nova'),
        defaultModel: env('NYV_OPENAI_TTS_MODEL', 'tts-1-hd'),
        get isConfigured(): boolean { return !!NYV_LLM.providers.openai.apiKey; },
      },
      browserTts: {
        id: 'browser-tts',
        enabled: true,
        cost: 0,
        isConfigured: true, // Always available (client-side)
      },
    },
    fallbackChain: envList('NYV_TTS_FALLBACK_CHAIN', ['elevenlabs', 'sarvam', 'openai-tts', 'browser-tts']),
    streamingEnabled: envBool('NYV_TTS_STREAMING', true),
    audioFormat: env('NYV_TTS_AUDIO_FORMAT', 'mp3'),
    sampleRate: envInt('NYV_TTS_SAMPLE_RATE', 22050),
  },

  // STT providers
  stt: {
    providers: {
      openaiWhisper: {
        id: 'openai-whisper',
        enabled: envBool('NYV_OPENAI_STT_ENABLED', true),
        model: env('NYV_OPENAI_STT_MODEL', 'whisper-1'),
        maxFileSizeMb: 25,
        supportedFormats: ['mp3', 'wav', 'ogg', 'm4a', 'webm'],
        get isConfigured(): boolean { return !!NYV_LLM.providers.openai.apiKey; },
      },
      deepgram: {
        id: 'deepgram',
        enabled: envBool('NYV_DEEPGRAM_ENABLED', false),
        apiKey: env('NYV_DEEPGRAM_API_KEY', env('DEEPGRAM_API_KEY', '')),
        baseUrl: env('NYV_DEEPGRAM_BASE_URL', 'wss://api.deepgram.com/v1/listen'),
        model: env('NYV_DEEPGRAM_MODEL', 'nova-3'),
        get isConfigured(): boolean { return !!this.apiKey; },
      },
      sarvamStt: {
        id: 'sarvam-stt',
        enabled: envBool('NYV_SARVAM_STT_ENABLED', false),
        apiKey: env('NYV_SARVAM_API_KEY', env('SARVAM_API_KEY', '')),
        supportedLanguages: ['hi', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'bn'],
        get isConfigured(): boolean { return !!this.apiKey; },
      },
    },
    fallbackChain: envList('NYV_STT_FALLBACK_CHAIN', ['gemini', 'openai-whisper', 'deepgram', 'sarvam-stt']),
    realtime: envBool('NYV_STT_REALTIME', true),
    language: env('NYV_STT_DEFAULT_LANGUAGE', 'en'),
    diarization: envBool('NYV_STT_DIARIZATION', false),
  },

  // WebSocket voice config
  ws: {
    path: '/ws/nyv/voice',
    maxSessionsPerUser: envInt('NYV_VOICE_WS_MAX_SESSIONS', 5),
    authTimeoutMs: envInt('NYV_VOICE_WS_AUTH_TIMEOUT_MS', 10_000),
    pingIntervalMs: envInt('NYV_VOICE_WS_PING_INTERVAL_MS', 30_000),
    maxMessageSizeBytes: envInt('NYV_VOICE_WS_MAX_MSG_BYTES', 10_000_000), // 10MB
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// COMMUNICATION CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const NYV_COMMS = {
  email: {
    host: env('NYV_SMTP_HOST', env('SMTP_HOST', '')),
    port: envInt('NYV_SMTP_PORT', 587),
    secure: envBool('NYV_SMTP_SECURE', false),
    user: env('NYV_SMTP_USER', env('SMTP_USER', '')),
    pass: env('NYV_SMTP_PASS', env('SMTP_PASS', '')),
    fromName: env('NYV_SMTP_FROM_NAME', 'Jurexio'),
    fromEmail: env('NYV_SMTP_FROM_EMAIL', ''),
    get isConfigured(): boolean { return !!(this.host && this.user && this.pass && this.fromEmail); },
  },

  whatsapp: {
    token: env('NYV_WHATSAPP_TOKEN', env('WHATSAPP_TOKEN', '')),
    phoneNumberId: env('NYV_WHATSAPP_PHONE_ID', env('WHATSAPP_PHONE_ID', '')),
    businessAccountId: env('NYV_WHATSAPP_BUSINESS_ID', ''),
    webhookVerifyToken: env('NYV_WHATSAPP_WEBHOOK_VERIFY', ''),
    baseUrl: 'https://graph.facebook.com/v18.0',
    get isConfigured(): boolean { return !!(this.token && this.phoneNumberId); },
  },

  sms: {
    provider: env('NYV_SMS_PROVIDER', 'twilio') as 'twilio' | 'vonage' | 'd7sms',
    twilio: {
      accountSid: env('NYV_TWILIO_ACCOUNT_SID', env('TWILIO_ACCOUNT_SID', '')),
      authToken: env('NYV_TWILIO_AUTH_TOKEN', env('TWILIO_AUTH_TOKEN', '')),
      fromNumber: env('NYV_TWILIO_FROM_NUMBER', ''),
      get isConfigured(): boolean { return !!(this.accountSid && this.authToken); },
    },
  },

  payment: {
    razorpay: {
      keyId: env('NYV_RAZORPAY_KEY_ID', env('RAZORPAY_KEY_ID', '')),
      keySecret: env('NYV_RAZORPAY_KEY_SECRET', env('RAZORPAY_KEY_SECRET', '')),
      webhookSecret: env('NYV_RAZORPAY_WEBHOOK_SECRET', ''),
      baseUrl: 'https://api.razorpay.com/v1',
      get isConfigured(): boolean { return !!(this.keyId && this.keySecret); },
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const NYV_SECURITY = {
  jwt: {
    secret: env('NYV_JWT_SECRET', env('JWT_SECRET', '')),
    refreshSecret: env('NYV_JWT_REFRESH_SECRET', env('JWT_REFRESH_SECRET', '')),
    expiryHours: envInt('NYV_JWT_EXPIRY_HOURS', 4),
    refreshExpiryDays: envInt('NYV_JWT_REFRESH_EXPIRY_DAYS', 30),
    algorithm: env('NYV_JWT_ALGORITHM', 'HS256') as 'HS256' | 'RS256' | 'ES256',
    issuer: env('NYV_JWT_ISSUER', 'nyayavigya-platform'),
    audience: env('NYV_JWT_AUDIENCE', 'nyv-sdk-v5'),
  },

  encryption: {
    atRest: envBool('NYV_ENCRYPTION_AT_REST', true),
    inTransit: envBool('NYV_ENCRYPTION_IN_TRANSIT', true),
    algorithm: env('NYV_ENCRYPTION_ALGO', 'AES-256-GCM'),
    keyDerivation: env('NYV_KEY_DERIVATION', 'PBKDF2'),
  },

  // Quantum-ready (post-quantum cryptography)
  quantum: {
    enabled: envBool('NYV_QUANTUM_ENABLED', false),
    kemAlgorithm: 'ML-KEM-512',    // CRYSTALS-Kyber
    signAlgorithm: 'ML-DSA-44',    // CRYSTALS-Dilithium
    zkpScheme: 'PLONK',
    bbProtocol: 'BB84',            // QKD
  },

  // Rate limiting
  rateLimits: {
    global: { windowMs: 60_000, maxRequests: envInt('NYV_RATE_LIMIT_GLOBAL', 1500) },
    llm: { windowMs: 60_000, maxRequests: envInt('NYV_RATE_LIMIT_LLM', 60) },
    auth: { windowMs: 60_000, maxRequests: envInt('NYV_RATE_LIMIT_AUTH', 10) },
    upload: { windowMs: 60_000, maxRequests: envInt('NYV_RATE_LIMIT_UPLOAD', 10) },
    sdk: { windowMs: 60_000, maxRequests: envInt('NYV_RATE_LIMIT_SDK', 300) },
  },

  // PII patterns (for all 6 jurisdictions)
  pii: {
    enabled: envBool('NYV_PII_ENABLED', true),
    autoRedact: envBool('NYV_PII_AUTO_REDACT', true),
    redactionChar: '█',
    cleanupIntervalMs: envInt('NYV_PII_CLEANUP_INTERVAL_MS', 300_000), // 5 min
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
      if (process.env.NYV_DEV_DOMAIN) {
        const d = process.env.NYV_DEV_DOMAIN;
        return [`https://${d}`, 'http://localhost:5000', 'http://localhost:3004'];
      }
      return ['*'];
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Organization-ID', 'X-Jurisdiction', 'X-NYV-SDK-Key'] as const,
    maxAgeSeconds: envInt('NYV_CORS_MAX_AGE', 86400),
  },

  // SDK API key format
  apiKey: {
    prefix: 'nyv_',
    length: envInt('NYV_API_KEY_LENGTH', 48),
    algorithm: 'sha256',
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// JURISDICTION CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const NYV_JURISDICTIONS = {
  IN: {
    code: 'IN', name: 'India', slmBinding: 'NYS-SLM-IND',
    dataResidency: 'ap-south-1',
    defaultLang: 'en', supportedLangs: ['hi', 'en', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'bn', 'or', 'pa', 'as', 'ur'],
    complianceFrameworks: ['DPDP Act 2023', 'IT Act 2000', 'RBI Guidelines', 'SEBI Regulations'],
    piiFields: ['aadhaar', 'pan', 'phone', 'email', 'passport'],
    dataRetentionDays: 2555,
    breachNotificationHours: 72,
  },
  UK: {
    code: 'UK', name: 'United Kingdom', slmBinding: 'NYS-SLM-UK',
    dataResidency: 'eu-west-2',
    defaultLang: 'en', supportedLangs: ['en', 'cy', 'gd'],
    complianceFrameworks: ['UK GDPR', 'Data Protection Act 2018', 'FCA Regulations'],
    piiFields: ['ukNino', 'phone', 'email', 'passport'],
    dataRetentionDays: 2555,
    breachNotificationHours: 72,
  },
  GCC: {
    code: 'GCC', name: 'Gulf Cooperation Council', slmBinding: 'NYS-SLM-GCC',
    dataResidency: 'me-south-1',
    defaultLang: 'ar', supportedLangs: ['ar', 'en'],
    complianceFrameworks: ['UAE PDPL 2021', 'DIFC DPL', 'Saudi PDPL 2022', 'NCA Cybersecurity'],
    piiFields: ['uaeId', 'phone', 'email', 'passport'],
    dataRetentionDays: 1825,
    breachNotificationHours: 72,
  },
  EU: {
    code: 'EU', name: 'European Union', slmBinding: 'NYS-SLM-EUR',
    dataResidency: 'eu-central-1',
    defaultLang: 'en', supportedLangs: ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'sv'],
    complianceFrameworks: ['GDPR', 'ePrivacy', 'Digital Services Act', 'EU AI Act', 'NIS2'],
    piiFields: ['phone', 'email', 'passport', 'creditCard'],
    dataRetentionDays: 1825,
    breachNotificationHours: 72,
  },
  US: {
    code: 'US', name: 'United States', slmBinding: 'NYS-SLM-USA',
    dataResidency: 'us-east-1',
    defaultLang: 'en', supportedLangs: ['en', 'es'],
    complianceFrameworks: ['CCPA/CPRA', 'HIPAA', 'SOX', 'GLBA', 'FCPA'],
    piiFields: ['ssn', 'phone', 'email', 'creditCard', 'passport'],
    dataRetentionDays: 2555,
    breachNotificationHours: 72,
  },
  SG: {
    code: 'SG', name: 'Singapore', slmBinding: 'NYS-SLM-SGP',
    dataResidency: 'ap-southeast-1',
    defaultLang: 'en', supportedLangs: ['en', 'zh', 'ms', 'ta'],
    complianceFrameworks: ['PDPA 2012', 'Cybersecurity Act 2018', 'Computer Misuse Act'],
    piiFields: ['sgNric', 'phone', 'email', 'passport'],
    dataRetentionDays: 1825,
    breachNotificationHours: 72,
  },
} as const;

export type JurisdictionCode = keyof typeof NYV_JURISDICTIONS;

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY / TELEMETRY
// ─────────────────────────────────────────────────────────────────────────────

export const NYV_OBSERVABILITY = {
  logging: {
    level: env('NYV_LOG_LEVEL', process.env.NODE_ENV === 'production' ? 'info' : 'debug') as 'debug' | 'info' | 'warn' | 'error',
    format: env('NYV_LOG_FORMAT', 'json') as 'json' | 'pretty',
    includeTraceId: envBool('NYV_LOG_TRACE_ID', true),
    maskSecrets: envBool('NYV_LOG_MASK_SECRETS', true),
  },

  metrics: {
    enabled: envBool('NYV_METRICS_ENABLED', true),
    provider: env('NYV_METRICS_PROVIDER', 'prometheus') as 'prometheus' | 'datadog' | 'cloudwatch',
    endpoint: env('NYV_METRICS_ENDPOINT', '/metrics'),
    collectIntervalMs: envInt('NYV_METRICS_INTERVAL_MS', 30_000),
  },

  tracing: {
    enabled: envBool('NYV_TRACING_ENABLED', false),
    provider: env('NYV_TRACING_PROVIDER', 'opentelemetry'),
    endpoint: env('NYV_OTEL_ENDPOINT', ''),
    serviceName: 'nyv-gateway',
    serviceVersion: NYV_PLATFORM_VERSION,
  },

  sentry: {
    dsn: env('NYV_SENTRY_DSN', env('SENTRY_DSN', '')),
    environment: env('NODE_ENV', 'development'),
    tracesSampleRate: envFloat('NYV_SENTRY_SAMPLE_RATE', 0.1),
    get isConfigured(): boolean { return !!this.dsn; },
  },

  healthCheck: {
    path: '/api/jrx/health',
    fullPath: '/api/jrx/health/full',
    timeoutMs: envInt('NYV_HEALTH_TIMEOUT_MS', 10_000),
    cacheTtlMs: envInt('NYV_HEALTH_CACHE_TTL_MS', 30_000),
  },

  // Audit trail
  audit: {
    enabled: envBool('NYV_AUDIT_ENABLED', true),
    retentionDays: envInt('NYV_AUDIT_RETENTION_DAYS', 2555), // 7 years
    includeRequestBody: envBool('NYV_AUDIT_INCLUDE_BODY', false),
    sensitiveHeaders: ['Authorization', 'X-NYV-SDK-Key', 'Cookie'],
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE FLAGS (Runtime toggleable)
// ─────────────────────────────────────────────────────────────────────────────

export const NYV_FEATURES = {
  // AI & Agents
  agentOrchestration: envBool('NYV_FEATURE_AGENTS', true),
  romaL5: envBool('NYV_FEATURE_ROMA_L5', true),
  grpo: envBool('NYV_FEATURE_GRPO', true),
  swarmTopologies: envBool('NYV_FEATURE_SWARM', true),
  hitl: envBool('NYV_FEATURE_HITL', true),
  digitalTwin: envBool('NYV_FEATURE_DIGITAL_TWIN', false),
  skillsSystem: envBool('NYV_FEATURE_SKILLS', true),

  // Document Intelligence
  ocr: envBool('NYV_FEATURE_OCR', true),
  documentConversion: envBool('NYV_FEATURE_DOC_CONVERT', true),
  clm: envBool('NYV_FEATURE_CLM', true),
  eFiling: envBool('NYV_FEATURE_EFILING', false), // requires court API keys

  // RAG & Knowledge
  graphRag: envBool('NYV_FEATURE_GRAPHRAG', true),
  adaptiveRag: envBool('NYV_FEATURE_ADAPTIVE_RAG', true),
  hybridSearch: envBool('NYV_FEATURE_HYBRID_SEARCH', true),
  semanticCache: envBool('NYV_FEATURE_SEMANTIC_CACHE', true),

  // Communication
  voiceInterface: envBool('NYV_FEATURE_VOICE', true),
  whatsApp: envBool('NYV_FEATURE_WHATSAPP', true),
  emailAutomation: envBool('NYV_FEATURE_EMAIL', true),
  smsAutomation: envBool('NYV_FEATURE_SMS', false),

  // Multimodal
  visionOcr: envBool('NYV_FEATURE_VISION', true),
  videoGeneration: envBool('NYV_FEATURE_VIDEO', false),
  avatarInterface: envBool('NYV_FEATURE_AVATAR', false),

  // Security
  quantumSecurity: envBool('NYV_FEATURE_QUANTUM', false),
  piiVault: envBool('NYV_FEATURE_PII_VAULT', true),
  hashChainAudit: envBool('NYV_FEATURE_HASH_CHAIN', true),
  biasDetection: envBool('NYV_FEATURE_BIAS_DETECT', true),

  // Platform
  multiLanguage: envBool('NYV_FEATURE_I18N', true),
  whiteLabel: envBool('NYV_FEATURE_WHITE_LABEL', true),
  paymentProcessing: envBool('NYV_FEATURE_PAYMENTS', !!process.env.NYV_RAZORPAY_KEY_ID),
  sdkAnalytics: envBool('NYV_FEATURE_SDK_ANALYTICS', true),

  // Kill switch
  aiGlobal: envBool('NYV_AI_GLOBAL_ENABLED', true),
  maxConcurrentAiRequests: envInt('NYV_AI_MAX_CONCURRENT', 50),
  emergencyShutdownCode: env('NYV_AI_EMERGENCY_CODE', ''),
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION PLUGIN CONFIGURATION
// (see nyv-integration-plugin-manager.ts for plugin registry)
// ─────────────────────────────────────────────────────────────────────────────

export const NYV_INTEGRATIONS = {
  // Third-party integrations — enable/disable per deployment
  enabled: envList('NYV_INTEGRATIONS_ENABLED', [
    'openai', 'anthropic', 'google', 'deepseek', 'sarvam', 'elevenlabs',
    'razorpay', 'email', 'whatsapp',
  ]),

  // Webhook settings for incoming events from 3rd party systems
  webhooks: {
    secret: env('NYV_WEBHOOK_SECRET', ''),
    timeoutMs: envInt('NYV_WEBHOOK_TIMEOUT_MS', 30_000),
    maxPayloadBytes: envInt('NYV_WEBHOOK_MAX_PAYLOAD_BYTES', 1_000_000),
    signatureHeader: 'X-NYV-Signature',
    timestampHeader: 'X-NYV-Timestamp',
    allowedSkewMs: envInt('NYV_WEBHOOK_ALLOWED_SKEW_MS', 300_000), // 5 min
  },

  // Plugin registry path (loaded at startup)
  pluginRegistryPath: env('NYV_PLUGIN_REGISTRY_PATH', 'src/integrations'),
  pluginAutoLoad: envBool('NYV_PLUGIN_AUTOLOAD', true),
  pluginTimeout: envInt('NYV_PLUGIN_TIMEOUT_MS', 10_000),
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// DATA GOVERNANCE / RETENTION
// ─────────────────────────────────────────────────────────────────────────────

export const NYV_GOVERNANCE = {
  retention: {
    enabled: envBool('NYV_RETENTION_ENABLED', true),
    runScheduleHours: envInt('NYV_RETENTION_SCHEDULE_HOURS', 24),
    policies: {
      activeCaseDays: envInt('NYV_RETAIN_ACTIVE_CASE_DAYS', 365),
      closedCaseDays: envInt('NYV_RETAIN_CLOSED_CASE_DAYS', 2555),
      auditLogDays: envInt('NYV_RETAIN_AUDIT_LOG_DAYS', 2555),
      sessionLogDays: envInt('NYV_RETAIN_SESSION_LOG_DAYS', 90),
      deletedUserDataDays: envInt('NYV_RETAIN_DELETED_USER_DAYS', 30),
      tempFilesDays: envInt('NYV_RETAIN_TEMP_FILES_DAYS', 7),
      embeddingsCacheDays: envInt('NYV_RETAIN_EMBEDDINGS_DAYS', 365),
    },
  },
  erasure: {
    cascadeDelete: true,
    anonymizeInstead: envBool('NYV_ERASURE_ANONYMIZE', false),
    retainAuditTrail: true,
    cooldownHours: envInt('NYV_ERASURE_COOLDOWN_HOURS', 48),
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// MASTER EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export const NYV_CONFIG = {
  platform: NYV_PLATFORM,
  nysPlaftorms: NYS_PLATFORMS,
  database: NYV_DATABASE,
  cache: NYV_CACHE,
  storage: NYV_STORAGE,
  llm: NYV_LLM,
  rag: NYV_RAG,
  agents: NYV_AGENTS,
  voice: NYV_VOICE,
  comms: NYV_COMMS,
  security: NYV_SECURITY,
  jurisdictions: NYV_JURISDICTIONS,
  observability: NYV_OBSERVABILITY,
  features: NYV_FEATURES,
  integrations: NYV_INTEGRATIONS,
  governance: NYV_GOVERNANCE,
} as const;

export type NYVConfig = typeof NYV_CONFIG;
export default NYV_CONFIG;
