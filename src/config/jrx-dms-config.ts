/**
 * JRX Document Management System — Unified Config
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for ALL document management knobs:
 *   - storage backend selection (S3 vs Local)
 *   - per-platform upload caps + streaming/presign toggles
 *   - BullMQ queue concurrency (parses, summarize, embed, AV, OCR)
 *   - cross-platform sharing policy + auto-share threshold
 *   - retention / TTL
 *   - OCR engine selection
 *   - document → agent ROMA L5 pattern routing
 *
 * Resolution order (highest precedence first):
 *   1. JRX_* environment variables (runtime override)
 *   2. config/storage/document-storage-deployment.yaml (deployment config)
 *   3. Built-in defaults below
 *
 * Per Phase 2A decisions LOCKED 2026-05-06:
 *   - Both Replit Object Storage + S3 adapters always available
 *   - Active backend chosen via YAML; flip Stage 1 ↔ Stage 2 with one line
 *   - Every queue param env-overridable
 *   - Sharing is platform-mediated by Jurexio, large docs auto-shared
 *
 * @see docs/v5.0.0/DOC-MGMT-PHASE2-ARCHITECTURE-PLAN-2026-05-06.md §10-§11
 * @module jrx-dms-config
 * @version 1.0.0
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('jrx-dms-config');

export type StorageActiveBackend = 's3' | 'local';

function normalizeDmsBackend(raw: string): StorageActiveBackend {
  const v = String(raw || '').toLowerCase();
  // Legacy Replit Object Storage is removed from the Cursor/AWS stack.
  // Treat it as S3 (production) or local if S3 is not explicitly configured.
  if (v === 'replit-object-storage' || v === 'replit') return 's3';
  if (v === 's3') return 's3';
  return 'local';
}

export type SharingPolicy = 'private' | 'org-shared' | 'ecosystem-shared';
export type PlatformCode = 'NSA' | 'NYM' | 'NSP' | 'NSPM' | 'NSI' | 'NSM' | 'JRX';

export interface QueueConfig {
  workerCount: number;
  jobsPerWorker: number;
  timeoutMs: number;
  retryAttempts: number;
}

export interface JrxDmsConfig {
  version: string;
  lastReviewed: string;
  backend: {
    active: StorageActiveBackend;
    sharedBucket: string;
    fallback: StorageActiveBackend;
  };
  uploads: {
    perPlatformMaxMb: Record<PlatformCode, number>;
    streamedUploadEnabled: boolean;
    presignedUploadEnabled: boolean;
    avScanEnabled: boolean;
    magicBytesValidationEnabled: boolean;
    multipartThresholdMb: number;
    presignedUrlTtlSec: number;
  };
  queues: {
    docParse: QueueConfig;
    docSummarize: QueueConfig;
    embedding: QueueConfig;
    avScan: QueueConfig;
    webhookDelivery: QueueConfig;
    ocr: QueueConfig;
  };
  sharing: {
    defaultPolicy: SharingPolicy;
    autoShareLargeDocs: boolean;
    autoShareThresholdMb: number;
    ecosystemPlatforms: PlatformCode[];
    auditEveryGrant: boolean;
    auditEveryCrossPlatformRead: boolean;
  };
  retention: {
    defaultDays: number;
    perPlatformDays: Partial<Record<PlatformCode, number>>;
    archiveBeforeDelete: boolean;
    archiveStorageClass: string;
  };
  ocr: {
    primaryEngine: 'tesseract' | 'got-ocr' | 'enhanced';
    fallbackEngine: 'tesseract' | 'got-ocr' | 'enhanced';
    languages: string[];
  };
  agentRouting: {
    defaultPattern: string;
    patternsByDocClass: Record<string, string>;
  };
}

const DEFAULTS: JrxDmsConfig = {
  version: '5.0.1-defaults',
  lastReviewed: 'built-in',
  backend: {
    active: 's3',
    sharedBucket: 'jrx-shared-documents',
    fallback: 'local',
  },
  uploads: {
    perPlatformMaxMb: { NSA: 10, NYM: 25, NSP: 100, NSPM: 100, NSI: 500, NSM: 1024, JRX: 100 },
    streamedUploadEnabled: true,
    presignedUploadEnabled: true,
    avScanEnabled: true,
    magicBytesValidationEnabled: true,
    multipartThresholdMb: 50,
    presignedUrlTtlSec: 3600,
  },
  queues: {
    docParse:        { workerCount: 4, jobsPerWorker: 2, timeoutMs: 600000, retryAttempts: 3 },
    docSummarize:    { workerCount: 3, jobsPerWorker: 2, timeoutMs: 600000, retryAttempts: 3 },
    embedding:       { workerCount: 2, jobsPerWorker: 4, timeoutMs: 300000, retryAttempts: 3 },
    avScan:          { workerCount: 2, jobsPerWorker: 2, timeoutMs: 120000, retryAttempts: 2 },
    webhookDelivery: { workerCount: 1, jobsPerWorker: 10, timeoutMs: 30000, retryAttempts: 5 },
    ocr:             { workerCount: 4, jobsPerWorker: 2, timeoutMs: 600000, retryAttempts: 3 },
  },
  sharing: {
    defaultPolicy: 'private',
    autoShareLargeDocs: true,
    autoShareThresholdMb: 50,
    ecosystemPlatforms: ['NSP', 'NSPM', 'NSI', 'NSM', 'NSA', 'NYM', 'JRX'],
    auditEveryGrant: true,
    auditEveryCrossPlatformRead: true,
  },
  retention: {
    defaultDays: 365,
    perPlatformDays: { NSA: 30, NYM: 180, NSP: 2555, NSI: 2555, NSM: 3650 },
    archiveBeforeDelete: true,
    archiveStorageClass: 'GLACIER_IR',
  },
  ocr: {
    primaryEngine: 'tesseract',
    fallbackEngine: 'enhanced',
    languages: ['eng', 'hin', 'tam', 'tel', 'kan', 'mar', 'ben', 'guj'],
  },
  agentRouting: {
    defaultPattern: 'P09_router',
    patternsByDocClass: {
      contract:       'P05_plan_exec',
      case_law:       'P12_graph_rag',
      statute:        'P11_nyaya_rag',
      evidence:       'P02_cot',
      correspondence: 'P01_react',
      filing:         'P07_maker_checker',
      compliance:     'P09_router',
    },
  },
};

/** Lower-cases & maps snake_case yaml keys onto our camelCase config shape. */
function fromYamlShape(y: any): Partial<JrxDmsConfig> {
  if (!y || typeof y !== 'object') return {};
  const num = (v: any, d: number) => (typeof v === 'number' ? v : d);
  const bool = (v: any, d: boolean) => (typeof v === 'boolean' ? v : d);
  const q = (yq: any, d: QueueConfig): QueueConfig => ({
    workerCount: num(yq?.worker_count, d.workerCount),
    jobsPerWorker: num(yq?.jobs_per_worker, d.jobsPerWorker),
    timeoutMs: num(yq?.timeout_ms, d.timeoutMs),
    retryAttempts: num(yq?.retry_attempts, d.retryAttempts),
  });
  return {
    version: y.version ?? DEFAULTS.version,
    lastReviewed: y.last_reviewed ?? DEFAULTS.lastReviewed,
    backend: {
      active: normalizeDmsBackend(y.backend?.active ?? DEFAULTS.backend.active),
      sharedBucket: y.backend?.shared_bucket ?? DEFAULTS.backend.sharedBucket,
      fallback: normalizeDmsBackend(y.backend?.fallback ?? DEFAULTS.backend.fallback),
    },
    uploads: {
      perPlatformMaxMb: { ...DEFAULTS.uploads.perPlatformMaxMb, ...(y.uploads?.per_platform_max_mb ?? {}) },
      streamedUploadEnabled: bool(y.uploads?.streamed_upload_enabled, DEFAULTS.uploads.streamedUploadEnabled),
      presignedUploadEnabled: bool(y.uploads?.presigned_upload_enabled, DEFAULTS.uploads.presignedUploadEnabled),
      avScanEnabled: bool(y.uploads?.av_scan_enabled, DEFAULTS.uploads.avScanEnabled),
      magicBytesValidationEnabled: bool(y.uploads?.magic_bytes_validation_enabled, DEFAULTS.uploads.magicBytesValidationEnabled),
      multipartThresholdMb: num(y.uploads?.multipart_threshold_mb, DEFAULTS.uploads.multipartThresholdMb),
      presignedUrlTtlSec: num(y.uploads?.presigned_url_ttl_sec, DEFAULTS.uploads.presignedUrlTtlSec),
    },
    queues: {
      docParse: q(y.queues?.doc_parse, DEFAULTS.queues.docParse),
      docSummarize: q(y.queues?.doc_summarize, DEFAULTS.queues.docSummarize),
      embedding: q(y.queues?.embedding, DEFAULTS.queues.embedding),
      avScan: q(y.queues?.av_scan, DEFAULTS.queues.avScan),
      webhookDelivery: q(y.queues?.webhook_delivery, DEFAULTS.queues.webhookDelivery),
      ocr: q(y.queues?.ocr, DEFAULTS.queues.ocr),
    },
    sharing: {
      defaultPolicy: (y.sharing?.default_policy ?? DEFAULTS.sharing.defaultPolicy) as SharingPolicy,
      autoShareLargeDocs: bool(y.sharing?.auto_share_large_docs, DEFAULTS.sharing.autoShareLargeDocs),
      autoShareThresholdMb: num(y.sharing?.auto_share_threshold_mb, DEFAULTS.sharing.autoShareThresholdMb),
      ecosystemPlatforms: (y.sharing?.ecosystem_platforms ?? DEFAULTS.sharing.ecosystemPlatforms) as PlatformCode[],
      auditEveryGrant: bool(y.sharing?.audit_every_grant, DEFAULTS.sharing.auditEveryGrant),
      auditEveryCrossPlatformRead: bool(y.sharing?.audit_every_cross_platform_read, DEFAULTS.sharing.auditEveryCrossPlatformRead),
    },
    retention: {
      defaultDays: num(y.retention?.default_days, DEFAULTS.retention.defaultDays),
      perPlatformDays: { ...DEFAULTS.retention.perPlatformDays, ...(y.retention?.per_platform_days ?? {}) },
      archiveBeforeDelete: bool(y.retention?.archive_before_delete, DEFAULTS.retention.archiveBeforeDelete),
      archiveStorageClass: y.retention?.archive_storage_class ?? DEFAULTS.retention.archiveStorageClass,
    },
    ocr: {
      primaryEngine: (y.ocr?.primary_engine ?? DEFAULTS.ocr.primaryEngine),
      fallbackEngine: (y.ocr?.fallback_engine ?? DEFAULTS.ocr.fallbackEngine),
      languages: y.ocr?.languages ?? DEFAULTS.ocr.languages,
    },
    agentRouting: {
      defaultPattern: y.agent_routing?.default_pattern ?? DEFAULTS.agentRouting.defaultPattern,
      patternsByDocClass: { ...DEFAULTS.agentRouting.patternsByDocClass, ...(y.agent_routing?.patterns_by_doc_class ?? {}) },
    },
  };
}

/** Apply JRX_* env var overrides (runtime precedence). */
function applyEnvOverrides(cfg: JrxDmsConfig): JrxDmsConfig {
  const numEnv = (k: string, d: number) => {
    const v = process.env[k]; if (!v) return d;
    const n = Number(v); return Number.isFinite(n) ? n : d;
  };
  const boolEnv = (k: string, d: boolean) => {
    const v = process.env[k]; if (v === undefined) return d;
    return v === '1' || v.toLowerCase() === 'true';
  };
  // Backend
  const envBackend = process.env.JRX_DMS_STORAGE_BACKEND as StorageActiveBackend | undefined;
  if (envBackend) cfg.backend.active = envBackend;

  // Queue concurrency knobs (per-queue env vars). Existing
  // JRX_WORKER_*_CONCURRENCY env vars take precedence so we do not break
  // queue-workers.ts wiring; we read the same env names here for visibility.
  cfg.queues.docParse.workerCount        = numEnv('JRX_WORKER_DOC_PARSE_CONCURRENCY',        cfg.queues.docParse.workerCount);
  cfg.queues.docSummarize.workerCount    = numEnv('JRX_WORKER_DOC_SUMMARIZE_CONCURRENCY',    cfg.queues.docSummarize.workerCount);
  cfg.queues.webhookDelivery.workerCount = numEnv('JRX_WORKER_WEBHOOK_CONCURRENCY',          cfg.queues.webhookDelivery.workerCount);
  cfg.queues.ocr.workerCount             = numEnv('JRX_OCR_WORKER_COUNT',                    cfg.queues.ocr.workerCount);
  cfg.queues.ocr.jobsPerWorker           = numEnv('JRX_OCR_JOBS_PER_WORKER',                 cfg.queues.ocr.jobsPerWorker);
  cfg.queues.ocr.timeoutMs               = numEnv('JRX_OCR_JOB_TIMEOUT_MS',                  cfg.queues.ocr.timeoutMs);
  cfg.queues.ocr.retryAttempts           = numEnv('JRX_OCR_RETRY_ATTEMPTS',                  cfg.queues.ocr.retryAttempts);
  cfg.queues.embedding.workerCount       = numEnv('JRX_EMBEDDING_WORKER_COUNT',              cfg.queues.embedding.workerCount);
  cfg.queues.avScan.workerCount          = numEnv('JRX_AV_SCAN_WORKER_COUNT',                cfg.queues.avScan.workerCount);

  // Upload toggles
  cfg.uploads.streamedUploadEnabled       = boolEnv('JRX_STREAMED_UPLOAD_ENABLED',  cfg.uploads.streamedUploadEnabled);
  cfg.uploads.presignedUploadEnabled      = boolEnv('JRX_PRESIGNED_UPLOAD_ENABLED', cfg.uploads.presignedUploadEnabled);
  cfg.uploads.avScanEnabled               = boolEnv('JRX_AV_SCAN_ENABLED',          cfg.uploads.avScanEnabled);
  cfg.uploads.magicBytesValidationEnabled = boolEnv('JRX_MAGIC_BYTES_ENABLED',      cfg.uploads.magicBytesValidationEnabled);
  cfg.uploads.presignedUrlTtlSec          = numEnv('JRX_PRESIGNED_URL_TTL_SEC',     cfg.uploads.presignedUrlTtlSec);

  // Sharing
  cfg.sharing.autoShareLargeDocs   = boolEnv('JRX_AUTO_SHARE_LARGE_DOCS',     cfg.sharing.autoShareLargeDocs);
  cfg.sharing.autoShareThresholdMb = numEnv('JRX_AUTO_SHARE_THRESHOLD_MB',    cfg.sharing.autoShareThresholdMb);

  return cfg;
}

let _cached: JrxDmsConfig | null = null;
let _loadedFrom: 'yaml' | 'defaults' | 'unknown' = 'unknown';

/** Load + memoize the DMS config. Safe to call from anywhere; loads exactly once. */
export function getJrxDmsConfig(): JrxDmsConfig {
  if (_cached) return _cached;

  const yamlPath = path.join(process.cwd(), 'config/storage/document-storage-deployment.yaml');
  let merged: JrxDmsConfig = JSON.parse(JSON.stringify(DEFAULTS));

  if (fs.existsSync(yamlPath)) {
    try {
      const raw = fs.readFileSync(yamlPath, 'utf8');
      const y = yaml.load(raw) as any;
      const partial = fromYamlShape(y);
      // Deep-merge partial onto defaults
      merged = {
        ...merged,
        ...partial,
        backend:    { ...merged.backend,    ...(partial.backend ?? {}) },
        uploads:    { ...merged.uploads,    ...(partial.uploads ?? {}) },
        queues:     { ...merged.queues,     ...(partial.queues ?? {}) },
        sharing:    { ...merged.sharing,    ...(partial.sharing ?? {}) },
        retention:  { ...merged.retention,  ...(partial.retention ?? {}) },
        ocr:        { ...merged.ocr,        ...(partial.ocr ?? {}) },
        agentRouting: { ...merged.agentRouting, ...(partial.agentRouting ?? {}) },
      };
      _loadedFrom = 'yaml';
    } catch (err: any) {
      logger.error('Failed to parse document-storage-deployment.yaml — using defaults', { err: err.message });
      _loadedFrom = 'defaults';
    }
  } else {
    logger.info('document-storage-deployment.yaml not found — using built-in defaults');
    _loadedFrom = 'defaults';
  }

  _cached = applyEnvOverrides(merged);
  logger.info('DMS config loaded', {
    source: _loadedFrom,
    backend: _cached.backend.active,
    sharedBucket: _cached.backend.sharedBucket,
    autoShareThresholdMb: _cached.sharing.autoShareThresholdMb,
    docParseWorkers: _cached.queues.docParse.workerCount,
    ocrWorkers: _cached.queues.ocr.workerCount,
  });
  return _cached;
}

/** TEST-ONLY: reset memoized config so tests can re-load with mutated env. */
export function _resetJrxDmsConfig(): void {
  _cached = null;
  _loadedFrom = 'unknown';
}

/** Diagnostic — useful in /api/jrx/admin/dms-config probe endpoints. */
export function getJrxDmsConfigSource(): { source: string; loaded: boolean } {
  return { source: _loadedFrom, loaded: _cached !== null };
}
