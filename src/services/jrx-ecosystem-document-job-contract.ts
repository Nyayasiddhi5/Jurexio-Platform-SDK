/**
 * NV-EDJ-CONTRACT-001 — Pure types + response formatters for ecosystem document jobs.
 */
import crypto from 'crypto';

export type EdjOutputProfile =
  | 'ingest_only'
  | 'summary'
  | 'extraction'
  | 'full_intelligence'
  | 'custom';

export type EdjTerminalStatus = 'completed' | 'partial' | 'failed' | 'expired' | 'cancelled';

export type EdjLifecycleStatus =
  | 'queued'
  | 'accepted'
  | 'fetching'
  | 'scanning'
  | 'parsing'
  | 'chunking'
  | 'embedding'
  | 'extracting'
  | 'analyzing'
  | 'delivering'
  | EdjTerminalStatus;

export type StorageRefType = 'nyv_shared_key' | 'presigned_get' | 'http_url' | 'nyv_doc_id' | 'inline_base64';

export interface StorageRef {
  type: StorageRefType;
  storageKey?: string;
  url?: string;
  expiresAt?: string;
  nyvDocId?: string;
  sha256?: string;
  sizeBytes?: number;
  mimeType?: string;
  fileName?: string;
  /** Inline payload for type=inline_base64 (preferred field name for SDK clients). */
  base64?: string;
  /** Legacy alias accepted by the worker (same as base64). */
  contentBase64?: string;
}

export interface FieldManifestField {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  extract?: {
    method: 'regex' | 'builtin' | 'llm' | 'tool';
    pattern?: string;
    handler?: string;
    instruction?: string;
    maxTokens?: number;
    toolId?: string;
    args?: Record<string, unknown>;
  };
}

export interface FieldManifest {
  version?: string;
  fields: FieldManifestField[];
}

export interface EdjDelivery {
  mode?: 'poll' | 'webhook' | 'poll_and_webhook';
  webhookUrl?: string;
  callbackMetadata?: Record<string, unknown>;
}

export interface CreateEdjRequest {
  platformCode?: string;
  correlationId: string;
  orgId: string;
  userId?: string;
  jurisdiction?: string;
  documentType?: string;
  consent?: { purpose?: string; granted?: boolean };
  storageRef: StorageRef;
  outputProfile?: EdjOutputProfile;
  outputOptions?: {
    enableRagIndex?: boolean;
    enableGraphRag?: boolean;
    languages?: string[];
    /** Canonical depth: concise | detailed | comprehensive (aliases accepted). */
    depth?: string;
    detailLevel?: string;
  };
  fieldManifest?: FieldManifest;
  delivery?: EdjDelivery;
  ttlSeconds?: number;
  legacyDocId?: number | string;
}

export interface EdjWorkerPayload extends CreateEdjRequest {
  jobId: string;
  platformCode: string;
  applicationId?: number;
  appType?: string;
  createdAt: string;
  expiresAt: string;
}

export interface EdjErrorBody {
  code: string;
  message: string;
  retryable: boolean;
  phase?: string;
}

export interface EdjRawContent {
  /** First N characters of the extracted text (preview for inline results). */
  preview: string;
  /** Total character count of the full extracted text. */
  charCount: number;
  /** Total word count of the full extracted text. */
  wordCount: number;
  /** Number of pages detected (estimated from content length if not OCR-reported). */
  pageCount: number;
  /** URL to fetch the complete raw content via GET. */
  contentUrl: string;
  /** MIME type of the raw content (always text/plain). */
  mimeType: 'text/plain';
  /** Encoding of the raw content (always utf-8). */
  encoding: 'utf-8';
}

export interface EdjResultEnvelope {
  jobId: string;
  platformCode: string;
  correlationId: string;
  ingest?: {
    nyvDocId: string;
    chunksIndexed: number;
    embeddingsGenerated: number;
    graphNodesAdded: number;
    ragReady: boolean;
    storagePath: string;
  };
  /** Raw parsed document content metadata + preview. Full text via contentUrl. */
  rawContent?: EdjRawContent;
  intelligence?: Record<string, unknown>;
  fields?: Record<string, unknown>;
  artifacts?: Record<string, { ref?: string; signedUrl?: string; expiresAt?: string; pageCount?: number }>;
  callbackMetadata?: Record<string, unknown>;
}

export const EDJ_INLINE_RESULT_MAX_BYTES = 256 * 1024;
export const EDJ_DEFAULT_TTL_SECONDS = 86_400;
/** Client poll hint — 1s keeps UX snappy without hammering status endpoints. */
export const EDJ_DEFAULT_POLL_MS = 1000;
/** Max chars of raw text included inline in the result envelope preview. */
export const EDJ_RAW_CONTENT_PREVIEW_CHARS = 2000;

export function edjJobId(): string {
  return `edj_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function platformFromAppType(appType?: string): string {
  const map: Record<string, string> = {
    'nyayasiddhi-professional': 'NSP',
    nsp: 'NSP',
    nsp_web: 'NSP',
    nsi: 'NSI',
    nym: 'NYM',
    nsa: 'NSA',
    nsm: 'NSM',
    jrx: 'JRX',
    nyv: 'JRX',
  };
  return map[(appType || '').toLowerCase()] || (appType || 'NSP').toUpperCase();
}

export function legacySharedDocsToEdj(body: Record<string, unknown>): CreateEdjRequest {
  // Prefer fast extraction unless caller explicitly asks for full intelligence.
  const wantFull =
    body.outputProfile === 'full_intelligence' ||
    body.enableIntelligence === true ||
    body.fullIntelligence === true;
  const enableRag =
    body.enableRag === true ||
    body.enableRagIndex === true ||
    (body.enableRag !== false && body.enableRagIndex !== false && wantFull);
  return {
    correlationId: String(body.docId ?? body.correlationId ?? crypto.randomUUID()),
    orgId: String(body.orgId),
    userId: body.userId ? String(body.userId) : undefined,
    jurisdiction: (body.jurisdiction as string) ?? 'IN',
    documentType: (body.documentType as string) ?? 'legal_document',
    legacyDocId: body.docId as number | string,
    storageRef: {
      type: 'nyv_shared_key',
      storageKey: String(body.storageKey),
      fileName: body.fileName ? String(body.fileName) : undefined,
      sizeBytes: body.sizeBytes ? Number(body.sizeBytes) : undefined,
      mimeType: body.mimeType ? String(body.mimeType) : undefined,
    },
    outputProfile: wantFull ? 'full_intelligence' : 'extraction',
    outputOptions: {
      enableRagIndex: enableRag,
      enableGraphRag: wantFull && body.enableGraphRag !== false,
      depth: wantFull ? 'comprehensive' : (typeof body.depth === 'string' ? body.depth : 'concise'),
      languages: Array.isArray(body.languages) ? (body.languages as string[]) : undefined,
    },
    delivery: {
      mode: 'poll_and_webhook',
      callbackMetadata: {
        docId: body.docId,
        orgId: body.orgId,
        shared_storage_key: body.storageKey,
      },
    },
  };
}

function parseInput(row: Record<string, unknown>): EdjWorkerPayload {
  const raw = row.input;
  if (typeof raw === 'string') return JSON.parse(raw) as EdjWorkerPayload;
  return raw as EdjWorkerPayload;
}

export interface EdjAccessCaller {
  applicationId?: number;
  appType?: string;
  userId?: string;
  /** Console platform admins may read any job for support/ops. */
  isPlatformAdmin?: boolean;
}

/**
 * Tenant / platform isolation for EDJ reads.
 * SDK callers may only access jobs created by the same applicationId or platformCode.
 * Fail-closed for authenticated SDK callers; JWT platform admins pass.
 */
export function canAccessEdjJob(row: Record<string, unknown>, caller: EdjAccessCaller): boolean {
  if (caller.isPlatformAdmin) return true;

  let payload: EdjWorkerPayload;
  try {
    payload = parseInput(row);
  } catch {
    return false;
  }

  if (caller.applicationId != null && payload.applicationId != null) {
    return Number(caller.applicationId) === Number(payload.applicationId);
  }

  const callerPlatform = platformFromAppType(caller.appType);
  if (payload.platformCode && caller.appType) {
    return String(payload.platformCode).toUpperCase() === callerPlatform.toUpperCase();
  }

  // Same submitting user (JWT or customer user id on the job row)
  if (caller.userId && row.user_id != null && String(row.user_id) === String(caller.userId)) {
    return true;
  }
  if (caller.userId && payload.userId && String(payload.userId) === String(caller.userId)) {
    return true;
  }

  // Authenticated SDK/platform caller without a match — deny (no cross-tenant leak)
  if (caller.applicationId != null || caller.appType) {
    return false;
  }

  return false;
}

export function formatEdjStatusResponse(row: Record<string, unknown>) {
  const input = parseInput(row);
  const output = typeof row.output === 'string' ? JSON.parse(row.output) : (row.output as Record<string, unknown> | null);
  const progress = output?._progress as { phase?: string; progress?: number } | undefined;
  const terminal = ['completed', 'partial', 'failed', 'expired', 'cancelled'].includes(String(row.status));
  const expiresAt = input.expiresAt;
  const expired = !terminal && expiresAt && Date.now() > new Date(expiresAt).getTime();

  const status = expired ? 'expired' : String(row.status);
  let resultInline: EdjResultEnvelope | null = null;
  let resultRef: { url: string; expiresAt: string; bytes?: number } | null = null;

  if (terminal && output && !output._progress) {
    const serialized = JSON.stringify(output);
    if (serialized.length <= EDJ_INLINE_RESULT_MAX_BYTES) {
      resultInline = output as EdjResultEnvelope;
    } else {
      resultRef = {
        url: `/api/jrx/v1/sdk/ecosystem-documents/jobs/${input.jobId}/result`,
        expiresAt: input.expiresAt,
        bytes: serialized.length,
      };
    }
  }

  return {
    jobId: input.jobId,
    taskId: input.jobId,
    status,
    phase: progress?.phase ?? (terminal ? status : 'queued'),
    progress: progress?.progress ?? (terminal ? 100 : 0),
    platformCode: input.platformCode,
    correlationId: input.correlationId,
    storageRef: input.storageRef,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    expiresAt,
    error: row.error_message
      ? { code: 'JOB_FAILED', message: String(row.error_message), retryable: false }
      : expired
        ? { code: 'JOB_EXPIRED', message: 'Job exceeded ttlSeconds without reaching a terminal state', retryable: true }
        : null,
    resultInline,
    resultRef,
    delivery: input.delivery,
    pollIntervalMs: EDJ_DEFAULT_POLL_MS,
    statusUrl: `/api/jrx/v1/sdk/ecosystem-documents/jobs/${input.jobId}`,
    resultUrl: `/api/jrx/v1/sdk/ecosystem-documents/jobs/${input.jobId}/result`,
  };
}
