/**
 * NV-EDJ-001 — Ecosystem Document Job (EDJ) service.
 * Durable async jobs for large/shared documents from Jurexio ecosystem platforms.
 */
import crypto from 'crypto';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';
import { nyvDocumentStorage } from './jrx-document-storage-service.js';
import { extractDocumentText } from './sdk/jrx-doc-content-extractor.js';
import { analyzeDocument } from './legal-doc-analyze-service.js';
import { autoShareIfLarge } from './jrx-doc-sharing-service.js';
import { dispatchWebhook } from './queue/webhook-dispatcher.js';
import { jobQueue as pgJobQueue } from './job-queue.js';
import type { PlatformCode } from '../config/jrx-dms-config.js';
import {
  edjJobId,
  platformFromAppType,
  EDJ_DEFAULT_POLL_MS,
  EDJ_DEFAULT_TTL_SECONDS,
  EDJ_RAW_CONTENT_PREVIEW_CHARS,
  type CreateEdjRequest,
  type EdjErrorBody,
  type EdjLifecycleStatus,
  type EdjOutputProfile,
  type EdjRawContent,
  type EdjResultEnvelope,
  type EdjWorkerPayload,
  type FieldManifest,
  type StorageRef,
} from './jrx-ecosystem-document-job-contract.js';

export type {
  CreateEdjRequest,
  EdjWorkerPayload,
  EdjResultEnvelope,
  EdjOutputProfile,
  StorageRef,
  FieldManifest,
} from './jrx-ecosystem-document-job-contract.js';
export {
  legacySharedDocsToEdj,
  formatEdjStatusResponse,
  canAccessEdjJob,
} from './jrx-ecosystem-document-job-contract.js';
export type { EdjAccessCaller } from './jrx-ecosystem-document-job-contract.js';

import {
  depthAnalysisFlags,
  parseIntelligenceDepth,
} from '../config/jrx-intelligence-depth.js';

const db = lazyRequire(() => _raw_db, 'db');
const logger = createLogger('ecosystem-document-job');

function analysisOptionsForProfile(
  profile: EdjOutputProfile,
  depthRaw?: string,
) {
  if (profile === 'ingest_only') {
    return {
      generateSummary: false,
      extractClauses: false,
      identifyObligations: false,
      assessRisks: false,
      findMissingTerms: false,
      detectPrivacyAlerts: false,
    };
  }
  const depth = parseIntelligenceDepth(depthRaw, 'detailed');
  const flags = depthAnalysisFlags(depth);
  if (profile === 'summary') {
    return {
      generateSummary: true,
      extractClauses: false,
      identifyObligations: false,
      assessRisks: flags.extractRisks && depth !== 'concise',
      findMissingTerms: false,
      detectPrivacyAlerts: false,
    };
  }
  if (profile === 'extraction') {
    // Fast path: summary + clauses only (skip obligations/risks/missing for UX latency).
    // Partners needing deeper intel should use full_intelligence / comprehensive depth.
    return {
      generateSummary: true,
      extractClauses: depth !== 'concise',
      identifyObligations: false,
      assessRisks: false,
      findMissingTerms: false,
      detectPrivacyAlerts: false,
      fastMode: true,
    };
  }
  return {
    generateSummary: flags.generateSummary,
    extractClauses: flags.extractClauses,
    identifyObligations: flags.extractObligations,
    assessRisks: flags.extractRisks,
    findMissingTerms: flags.extractMissingTerms,
    detectPrivacyAlerts: flags.extractPrivacy,
  };
}

export class EdjProcessingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly phase?: string,
  ) {
    super(message);
    this.name = 'EdjProcessingError';
  }
}

async function updateJobProgress(
  jobId: string,
  status: string,
  phase: EdjLifecycleStatus,
  progress: number,
  extras?: { output?: unknown; error?: EdjErrorBody },
): Promise<void> {
  try {
    if (extras?.output !== undefined) {
      await db.execute(sql`
        UPDATE nv_schema.async_job_queue
        SET status = ${status},
            output = ${JSON.stringify(extras.output)},
            updated_at = NOW(),
            started_at = COALESCE(started_at, NOW()),
            completed_at = NOW()
        WHERE job_id = ${jobId}
      `);
      return;
    }
    if (extras?.error) {
      await db.execute(sql`
        UPDATE nv_schema.async_job_queue
        SET status = ${status},
            error_message = ${extras.error.message},
            output = ${JSON.stringify({ error: extras.error })},
            updated_at = NOW(),
            completed_at = NOW()
        WHERE job_id = ${jobId}
      `);
      return;
    }
    await db.execute(sql`
      UPDATE nv_schema.async_job_queue
      SET status = ${status},
          output = ${JSON.stringify({ _progress: { phase, progress } })},
          updated_at = NOW(),
          started_at = COALESCE(started_at, NOW())
      WHERE job_id = ${jobId}
    `);
  } catch (err: unknown) {
    logger.warn('edj_progress_update_failed', { jobId, err: err instanceof Error ? err.message : String(err) });
  }
}

async function fetchStorageBuffer(ref: StorageRef): Promise<Buffer> {
  if (ref.type === 'nyv_shared_key') {
    if (!ref.storageKey || ref.storageKey === 'undefined') {
      throw new EdjProcessingError('STORAGE_NOT_FOUND', 'storageKey required for nyv_shared_key', true, 'fetching');
    }
    return nyvDocumentStorage.downloadRaw(ref.storageKey);
  }
  if (ref.type === 'presigned_get' || ref.type === 'http_url') {
    if (!ref.url) throw new EdjProcessingError('STORAGE_NOT_FOUND', 'url required for presigned_get/http_url', true, 'fetching');
    const res = await fetch(ref.url);
    if (res.ok === false) throw new EdjProcessingError('STORAGE_NOT_FOUND', `presigned fetch HTTP ${res.status}`, true, 'fetching');
    return Buffer.from(await res.arrayBuffer());
  }
  if (ref.type === 'nyv_doc_id') {
    if (!ref.nyvDocId) throw new EdjProcessingError('STORAGE_NOT_FOUND', 'nyvDocId required', true, 'fetching');
    const row = await db.execute(sql`
      SELECT storage_path FROM nv_schema.nv_document_ingest_status WHERE doc_id = ${ref.nyvDocId} LIMIT 1
    `);
    const storagePath = (row.rows?.[0] as { storage_path?: string } | undefined)?.storage_path;
    if (!storagePath) throw new EdjProcessingError('STORAGE_NOT_FOUND', `nyv doc ${ref.nyvDocId} not found`, false, 'fetching');
    return nyvDocumentStorage.downloadRaw(storagePath);
  }
  // NV-EDJ-INLINE-001: allow tiny inline payloads for SDK / NSP integration tests.
  // Accept both `base64` (canonical) and legacy `contentBase64`.
  if (ref.type === 'inline_base64') {
    const raw = typeof ref.base64 === 'string' ? ref.base64
      : typeof ref.contentBase64 === 'string' ? ref.contentBase64
      : '';
    if (!raw) {
      throw new EdjProcessingError(
        'STORAGE_NOT_FOUND',
        'inline_base64 requires storageRef.base64 (or contentBase64)',
        false,
        'fetching',
      );
    }
    const cleaned = raw.replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(cleaned, 'base64');
    if (!buf.length) throw new EdjProcessingError('STORAGE_NOT_FOUND', 'inline_base64 empty', false, 'fetching');
    return buf;
  }
  throw new EdjProcessingError('STORAGE_NOT_FOUND', `unsupported storageRef.type ${ref.type}`, false, 'fetching');
}

function resolveBuiltinField(handler: string, analysis: Record<string, unknown>): unknown {
  switch (handler) {
    case 'summary': return analysis.summary;
    case 'parties': return analysis.parties ?? analysis.clauses;
    case 'obligations': return analysis.obligations;
    case 'risks': return analysis.risks;
    case 'clauses': return analysis.clauses;
    case 'documentType': return analysis.documentType ?? analysis.document_type;
    case 'missingTerms': return analysis.missingTerms ?? analysis.missing_provisions;
    case 'privacyAlerts': return analysis.privacyAlerts ?? analysis.privacy_alerts;
    default: return null;
  }
}

type EdjFieldResolutionStatus = 'RESOLVED' | 'LOW_CONFIDENCE' | 'CONFLICT' | 'ABSENT';

interface EdjManifestFieldEnvelope {
  value: unknown;
  status: EdjFieldResolutionStatus;
  confidence?: number;
}

function normalizeEdjFieldEnvelope(
  raw: unknown,
  fieldKey: string,
): EdjManifestFieldEnvelope {
  if (raw == null || raw === '') {
    return { value: null, status: 'ABSENT', confidence: 0 };
  }
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const statusRaw = String(obj.status || '').toUpperCase();
    const status: EdjFieldResolutionStatus =
      statusRaw === 'LOW_CONFIDENCE' || statusRaw === 'CONFLICT' || statusRaw === 'ABSENT' || statusRaw === 'RESOLVED'
        ? statusRaw as EdjFieldResolutionStatus
        : obj.value == null || obj.value === ''
          ? 'ABSENT'
          : 'RESOLVED';
    const confidence = typeof obj.confidence === 'number' ? obj.confidence : undefined;
    if (status === 'CONFLICT') {
      return { value: obj.value ?? obj.candidates ?? null, status: 'CONFLICT', confidence: confidence ?? 0.42 };
    }
    if (status === 'LOW_CONFIDENCE') {
      return { value: obj.value ?? null, status: 'LOW_CONFIDENCE', confidence: confidence ?? 0.55 };
    }
    if (status === 'ABSENT') {
      return { value: null, status: 'ABSENT', confidence: 0 };
    }
    return { value: obj.value ?? raw, status: 'RESOLVED', confidence: confidence ?? 0.88 };
  }
  return { value: raw, status: 'RESOLVED', confidence: 0.85 };
}

async function extractLlmManifestFieldsBatch(
  text: string,
  llmFields: Array<{ key: string; label?: string; instruction?: string }>,
  ctx: { orgId: string; platformCode: string },
): Promise<Record<string, EdjManifestFieldEnvelope>> {
  if (!llmFields.length) return {};
  const { executeWithFullSafetyRing } = await import('../orchestration/jrx-sdk-orchestration-wrapper.js');
  const snippet = text.slice(0, 14_000);
  const fieldSpec = llmFields
    .map((f) => `- "${f.key}" (${f.label || f.key}): ${f.instruction || 'Extract from document; null if absent.'}`)
    .join('\n');
  const userPrompt = `Extract ALL listed fields from this document excerpt.\n\nFields:\n${fieldSpec}\n\nDocument:\n${snippet}`;
  const systemPrompt =
    `You extract structured values from legal/business documents. Respond with ONLY valid JSON:\n` +
    `{"fields":{ "<fieldKey>": {"value": <string|number|null|object>, "status": "RESOLVED"|"LOW_CONFIDENCE"|"CONFLICT"|"ABSENT", "confidence": 0.0-1.0 } }}\n` +
    `Use ABSENT when not found; LOW_CONFIDENCE when uncertain; CONFLICT when multiple plausible values. No markdown.`;
  const response = await executeWithFullSafetyRing(
    {
      id: crypto.randomUUID(),
      userId: `edj-${ctx.platformCode}`,
      prompt: userPrompt,
      systemPrompt,
      model: 'auto',
      maxTokens: Math.min(4096, 256 * llmFields.length + 512),
      temperature: 0.1,
      requirements: {
        complexity: 'medium',
        domain: 'analytical',
        priority: 'medium',
        costBudget: 'balanced',
        responseTime: 'fastest',
        qualityLevel: 'professional',
      },
      fallbackLevels: 2,
      timestamp: new Date(),
    },
    {
      ctx: { organizationId: ctx.orgId },
      sdkPlatform: ctx.platformCode,
      agentKey: 'legal-analyst',
      taskType: 'field_extraction',
      domainContext: `EDJ fieldManifest llm batch (${llmFields.length} fields)`,
      riskCategory: 'low',
      enableHallucinationCheck: false,
      enableCitationVerification: false,
      enableRAG: false,
      enableMemory: false,
    },
  );
  const raw = (response.content || '').replace(/```json\s*|```/gi, '').trim();
  const out: Record<string, EdjManifestFieldEnvelope> = {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const fieldsBlock = (parsed.fields && typeof parsed.fields === 'object')
      ? parsed.fields as Record<string, unknown>
      : parsed;
    for (const f of llmFields) {
      out[f.key] = normalizeEdjFieldEnvelope(fieldsBlock[f.key], f.key);
    }
  } catch {
    for (const f of llmFields) {
      out[f.key] = { value: null, status: 'ABSENT', confidence: 0 };
    }
  }
  return out;
}

async function extractLlmManifestField(
  text: string,
  fieldKey: string,
  fieldLabel: string | undefined,
  extractPrompt: string | undefined,
  ctx: { orgId: string; platformCode: string },
): Promise<unknown> {
  const { executeWithFullSafetyRing } = await import('../orchestration/jrx-sdk-orchestration-wrapper.js');
  const snippet = text.slice(0, 12_000);
  const label = fieldLabel || fieldKey;
  const instruction =
    extractPrompt ||
    `Extract the value for field "${fieldKey}" (${label}) from the document. If not found, use null.`;
  const userPrompt = `${instruction}\n\nDocument excerpt:\n${snippet}`;
  const systemPrompt =
    'You extract structured values from legal/business documents. Respond with ONLY valid JSON: {"value": <string|number|null|object>}. No markdown.';
  const response = await executeWithFullSafetyRing(
    {
      id: crypto.randomUUID(),
      userId: `edj-${ctx.platformCode}`,
      prompt: userPrompt,
      systemPrompt,
      model: 'auto',
      maxTokens: 512,
      temperature: 0.1,
      requirements: {
        complexity: 'medium',
        domain: 'analytical',
        priority: 'medium',
        costBudget: 'balanced',
        responseTime: 'fastest',
        qualityLevel: 'professional',
      },
      fallbackLevels: 2,
      timestamp: new Date(),
    },
    {
      ctx: { organizationId: ctx.orgId },
      sdkPlatform: ctx.platformCode,
      agentKey: 'legal-analyst',
      taskType: 'field_extraction',
      domainContext: `EDJ fieldManifest llm: ${fieldKey}`,
      riskCategory: 'low',
      enableHallucinationCheck: false,
      enableCitationVerification: false,
      enableRAG: false,
      enableMemory: false,
    },
  );
  const raw = (response.content || '').replace(/```json\s*|```/gi, '').trim();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.value !== undefined) return parsed.value;
    if (fieldKey in parsed) return parsed[fieldKey];
    return null;
  } catch {
    return raw.length > 0 && raw.length < 500 ? raw : null;
  }
}

async function extractManifestFields(
  text: string,
  manifest: FieldManifest | undefined,
  analysis: Record<string, unknown>,
  ctx: { orgId: string; platformCode: string },
): Promise<Record<string, unknown>> {
  if (!manifest?.fields?.length) return {};
  const fields: Record<string, unknown> = {};
  const llmFields: Array<{ key: string; label?: string; instruction?: string }> = [];

  for (const f of manifest.fields) {
    const ex = f.extract;
    if (!ex) continue;
    try {
      if (ex.method === 'regex' && ex.pattern) {
        const re = new RegExp(ex.pattern, 'im');
        const m = text.match(re);
        const val = m?.[1] ?? m?.[0] ?? null;
        fields[f.key] = val != null && val !== ''
          ? { value: val, status: 'RESOLVED', confidence: 0.9 }
          : { value: null, status: 'ABSENT', confidence: 0 };
      } else if (ex.method === 'builtin' && ex.handler) {
        const val = resolveBuiltinField(ex.handler, analysis);
        fields[f.key] = val != null && val !== ''
          ? { value: val, status: 'RESOLVED', confidence: 0.92 }
          : { value: null, status: 'ABSENT', confidence: 0 };
      } else if (ex.method === 'llm') {
        llmFields.push({ key: f.key, label: f.key, instruction: ex.instruction });
      } else {
        fields[f.key] = { value: null, status: 'ABSENT', confidence: 0 };
      }
    } catch (err: unknown) {
      logger.warn('edj_field_extract_failed', {
        key: f.key,
        method: ex.method,
        err: err instanceof Error ? err.message : String(err),
      });
      fields[f.key] = { value: null, status: 'ABSENT', confidence: 0 };
    }
  }

  if (llmFields.length === 1) {
    try {
      const single = await extractLlmManifestField(
        text,
        llmFields[0]!.key,
        llmFields[0]!.label,
        llmFields[0]!.instruction,
        ctx,
      );
      fields[llmFields[0]!.key] = normalizeEdjFieldEnvelope(single, llmFields[0]!.key);
    } catch (err: unknown) {
      logger.warn('edj_field_extract_failed', {
        key: llmFields[0]!.key,
        method: 'llm',
        err: err instanceof Error ? err.message : String(err),
      });
      fields[llmFields[0]!.key] = { value: null, status: 'ABSENT', confidence: 0 };
    }
  } else if (llmFields.length > 1) {
    try {
      const batch = await extractLlmManifestFieldsBatch(text, llmFields, ctx);
      for (const f of llmFields) {
        fields[f.key] = batch[f.key] ?? { value: null, status: 'ABSENT', confidence: 0 };
      }
    } catch (err: unknown) {
      logger.warn('edj_field_extract_batch_failed', {
        count: llmFields.length,
        err: err instanceof Error ? err.message : String(err),
      });
      for (const f of llmFields) {
        fields[f.key] = { value: null, status: 'ABSENT', confidence: 0 };
      }
    }
  }

  return fields;
}

function analysisToIntelligence(analysis: Record<string, unknown>): Record<string, unknown> {
  return {
    summary: analysis.summary,
    documentType: analysis.documentType ?? analysis.document_type,
    overallRiskLevel: analysis.overallRiskLevel ?? analysis.overall_risk_level,
    confidenceScore: analysis.confidenceScore ?? analysis.confidence_score,
    parties: analysis.parties ?? [],
    obligations: analysis.obligations ?? [],
    risks: analysis.risks ?? [],
    statutes: analysis.statutes ?? [],
    clauses: analysis.clauses ?? [],
    missingTerms: analysis.missingTerms ?? analysis.missing_provisions ?? [],
    privacyAlerts: analysis.privacyAlerts ?? analysis.privacy_alerts ?? [],
    insights: analysis.keyPoints ?? analysis.insights ?? [],
    riskDistribution: analysis.riskDistribution,
    /* NV-ANALYZE-STATUS-005 — every array above defaults to `[]`, so without these the
     * webhook payload cannot distinguish an empty analysis from a failed one. Carried
     * through rather than recomputed so the async EDJ result matches the sync analyze
     * routes. */
    analysisStatus: analysis.analysisStatus ?? 'unstructured',
    analysisStatusReason:
      analysis.analysisStatusReason
      ?? 'Analysis status was not reported by the analyzer; treat empty arrays as unconfirmed.',
    failedExtractors: analysis.failedExtractors ?? [],
  };
}

async function lookupAppWebhook(applicationId?: number): Promise<{ url: string; secret: string } | null> {
  if (!applicationId) return null;
  try {
    const result = await db.execute(sql`
      SELECT webhook_url, webhook_secret FROM sdk_applications WHERE id = ${applicationId} LIMIT 1
    `);
    const row = result.rows?.[0] as { webhook_url?: string; webhook_secret?: string } | undefined;
    if (row?.webhook_url && row?.webhook_secret) {
      return { url: row.webhook_url, secret: row.webhook_secret };
    }
  } catch {
    /* best-effort */
  }
  return null;
}

export async function deliverEdjWebhook(
  payload: EdjWorkerPayload,
  event: 'document.job.completed' | 'document.job.failed' | 'document.job.progress',
  body: Record<string, unknown>,
): Promise<void> {
  const mode = payload.delivery?.mode ?? 'poll_and_webhook';
  if (mode === 'poll') return;

  const url = payload.delivery?.webhookUrl ?? (await lookupAppWebhook(payload.applicationId))?.url;
  const secret =
    (await lookupAppWebhook(payload.applicationId))?.secret
    ?? process.env.JRX_WEBHOOK_FALLBACK_SECRET;

  if (!url || !secret) return;

  try {
    await dispatchWebhook({
      appId: String(payload.applicationId ?? payload.platformCode),
      platform: payload.platformCode,
      url,
      event,
      secret,
      correlationId: payload.correlationId,
      payload: {
        jobId: payload.jobId,
        correlationId: payload.correlationId,
        platformCode: payload.platformCode,
        callbackMetadata: payload.delivery?.callbackMetadata ?? {},
        ...body,
      },
    });
  } catch (err: unknown) {
    logger.warn('edj_webhook_enqueue_failed', { jobId: payload.jobId, err: err instanceof Error ? err.message : String(err) });
  }
}

async function touchLegacyNsDocument(docId: number | string | undefined, status: string, analysis?: Record<string, unknown>): Promise<void> {
  if (!docId) return;
  const id = parseInt(String(docId), 10);
  if (!Number.isFinite(id)) return;
  try {
    if (status === 'completed' && analysis) {
      await db.execute(sql`
        UPDATE ns_documents
        SET status = 'analyzed', analysis_complete = TRUE,
            analysis_result = ${JSON.stringify(analysis)}, updated_at = NOW()
        WHERE id = ${id}
      `);
    } else if (status === 'failed') {
      await db.execute(sql`UPDATE ns_documents SET status = 'error', updated_at = NOW() WHERE id = ${id}`);
    } else {
      await db.execute(sql`UPDATE ns_documents SET status = ${status}, updated_at = NOW() WHERE id = ${id}`);
    }
  } catch {
    /* NSP table may be absent on some envs */
  }
}

export async function createEcosystemDocumentJob(
  request: CreateEdjRequest,
  ctx: { userId: string; applicationId?: number; appType?: string },
): Promise<{
  jobId: string;
  status: 'queued';
  statusUrl: string;
  resultUrl: string;
  pollIntervalMs: number;
  expiresAt: string;
  taskId: string;
}> {
  if (!request.correlationId) throw new Error('correlationId is required');
  if (!request.orgId) throw new Error('orgId is required');
  if (!request.storageRef?.type) throw new Error('storageRef is required');

  const jobId = edjJobId();
  const ttl = request.ttlSeconds ?? EDJ_DEFAULT_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const platformCode = request.platformCode || platformFromAppType(ctx.appType);

  const workerPayload: EdjWorkerPayload = {
    ...request,
    jobId,
    platformCode,
    applicationId: ctx.applicationId,
    appType: ctx.appType,
    outputProfile: request.outputProfile ?? 'extraction',
    outputOptions: {
      // Default RAG/GraphRAG only for full_intelligence; extraction stays fast unless opted in.
      enableRagIndex:
        request.outputOptions?.enableRagIndex ??
        ((request.outputProfile ?? 'extraction') === 'full_intelligence'),
      enableGraphRag:
        request.outputOptions?.enableGraphRag ??
        ((request.outputProfile ?? 'extraction') === 'full_intelligence'),
      languages: request.outputOptions?.languages ?? ['en'],
      depth: request.outputOptions?.depth ?? request.outputOptions?.detailLevel,
      detailLevel: request.outputOptions?.detailLevel,
    },
    createdAt: new Date().toISOString(),
    expiresAt,
  };

  await db.execute(sql`
    INSERT INTO nv_schema.async_job_queue (job_id, job_type, status, input, user_id, priority, created_at)
    VALUES (
      ${jobId},
      'ecosystem_document_job',
      'queued',
      ${JSON.stringify(workerPayload)},
      ${ctx.userId},
      'normal',
      NOW()
    )
  `);

  // NV-EDJ-BULLMQ-001: prefer BullMQ when live; keep PG enqueue only as fallback
  // so we never double-process the same jobId on both workers.
  let queuedOnBullmq = false;
  try {
    const { enqueueEcosystemDocJob, isQueueLive } = await import('./queue/bullmq-queue.js');
    if (isQueueLive()) {
      const r = await enqueueEcosystemDocJob({
        ...workerPayload,
        jobId,
        userId: ctx.userId,
      });
      queuedOnBullmq = !!(r && !(r as { disabled?: boolean }).disabled);
      if (queuedOnBullmq) {
        logger.info('edj_enqueued_bullmq', { jobId });
      }
    }
  } catch (e: any) {
    logger.warn('edj_bullmq_enqueue_failed', { jobId, err: e?.message });
  }
  if (!queuedOnBullmq) {
    await pgJobQueue.enqueue({
      queue: './jrx-documents',
      taskType: 'ecosystem_document_job',
      payload: { ...workerPayload, _jobId: jobId, _userId: ctx.userId },
      priority: 80,
      createdBy: ctx.userId,
      platform: platformCode,
    });
    logger.info('edj_enqueued_pg_fallback', { jobId });
  }

  const legacyDoc = request.legacyDocId ?? request.delivery?.callbackMetadata?.nspDocumentId ?? request.delivery?.callbackMetadata?.docId;
  await touchLegacyNsDocument(legacyDoc as string | number | undefined, 'processing');

  logger.info('edj_created', { jobId, platformCode, correlationId: request.correlationId });

  return {
    jobId,
    taskId: jobId,
    status: 'queued',
    statusUrl: `/api/jrx/v1/sdk/ecosystem-documents/jobs/${jobId}`,
    resultUrl: `/api/jrx/v1/sdk/ecosystem-documents/jobs/${jobId}/result`,
    pollIntervalMs: EDJ_DEFAULT_POLL_MS,
    expiresAt,
  };
}

export async function getEcosystemDocumentJobRow(jobId: string): Promise<Record<string, unknown> | null> {
  const result = await db.execute(sql`
    SELECT * FROM nv_schema.async_job_queue WHERE job_id = ${jobId} LIMIT 1
  `);
  const row = (result.rows?.[0] ?? null) as Record<string, unknown> | null;
  return row;
}

export async function getEcosystemDocumentJobResult(jobId: string): Promise<EdjResultEnvelope | null> {
  const row = await getEcosystemDocumentJobRow(jobId);
  if (!row) return null;
  const output = typeof row.output === 'string' ? JSON.parse(row.output) : row.output;
  if (!output || output._progress) return null;
  return output as EdjResultEnvelope;
}

export interface EdjRawContentResponse {
  jobId: string;
  platformCode: string;
  correlationId: string;
  /** Full raw parsed text from OCR/extraction. */
  content: string;
  charCount: number;
  wordCount: number;
  pageCount: number;
  mimeType: 'text/plain';
  encoding: 'utf-8';
  extractedAt: string;
  /**
   * Extracted fields from the fieldManifest (if requested during job creation).
   * Platforms use this for structured data extraction without running their own NLP.
   */
  fields: Record<string, unknown> | null;
  /**
   * Document metadata detected during processing.
   */
  documentMeta: {
    documentType?: string;
    jurisdiction?: string;
    language?: string;
    fileName?: string;
    storagePath?: string;
    nyvDocId?: string;
  } | null;
}

/**
 * Retrieve the full raw parsed document text + extracted fields for a completed EDJ.
 * Returns both so platforms can choose: raw text for custom processing,
 * fields for structured extraction, or both.
 */
export async function getEcosystemDocumentJobContent(jobId: string): Promise<EdjRawContentResponse | null> {
  const row = await getEcosystemDocumentJobRow(jobId);
  if (!row) return null;

  const status = String(row.status);
  if (!['completed', 'partial'].includes(status)) return null;

  const input = typeof row.input === 'string' ? JSON.parse(row.input) : row.input;
  const output = typeof row.output === 'string' ? JSON.parse(row.output) : row.output;
  const payload = input as EdjWorkerPayload;

  const fields = (output?.fields as Record<string, unknown>) ?? null;
  const documentMeta = {
    documentType: payload.documentType,
    jurisdiction: payload.jurisdiction,
    language: payload.outputOptions?.languages?.[0],
    fileName: payload.storageRef?.fileName,
    storagePath: (output?.ingest as Record<string, unknown>)?.storagePath as string | undefined,
    nyvDocId: (output?.ingest as Record<string, unknown>)?.nyvDocId as string | undefined,
  };

  // Try fetching from object storage first
  const rawTextPath = output?.artifacts?.rawText?.ref as string | undefined;
  if (rawTextPath) {
    try {
      const buffer = await nyvDocumentStorage.downloadRaw(rawTextPath);
      const content = buffer.toString('utf-8');
      return {
        jobId,
        platformCode: payload.platformCode,
        correlationId: payload.correlationId,
        content,
        charCount: content.length,
        wordCount: content.split(/\s+/).filter(Boolean).length,
        pageCount: output?.rawContent?.pageCount ?? Math.max(1, Math.ceil(content.length / 3000)),
        mimeType: 'text/plain',
        encoding: 'utf-8',
        extractedAt: String(row.completed_at || row.started_at || ''),
        fields,
        documentMeta,
      };
    } catch (err: unknown) {
      logger.warn('edj_raw_content_download_failed', { jobId, err: err instanceof Error ? err.message : String(err) });
    }
  }

  // Fallback: if rawContent.preview is in the result and that's all we have
  if (output?.rawContent?.preview) {
    return {
      jobId,
      platformCode: payload.platformCode,
      correlationId: payload.correlationId,
      content: output.rawContent.preview,
      charCount: output.rawContent.charCount ?? output.rawContent.preview.length,
      wordCount: output.rawContent.wordCount ?? output.rawContent.preview.split(/\s+/).filter(Boolean).length,
      pageCount: output.rawContent.pageCount ?? 1,
      mimeType: 'text/plain',
      encoding: 'utf-8',
      extractedAt: String(row.completed_at || row.started_at || ''),
      fields,
      documentMeta,
    };
  }

  return null;
}

export async function processEcosystemDocumentJob(payload: EdjWorkerPayload): Promise<EdjResultEnvelope> {
  const jobId = payload.jobId;
  const orgId = payload.orgId;
  const userId = payload.userId ?? 'ecosystem';
  const platformCode = payload.platformCode || 'NSP';
  const correlationId = payload.correlationId;
  const profile = payload.outputProfile ?? 'extraction';
  const enableRag = payload.outputOptions?.enableRagIndex !== false;

  await updateJobProgress(jobId, 'processing', 'fetching', 5);
  await deliverEdjWebhook(payload, 'document.job.progress', { phase: 'fetching', progress: 5 });

  const buffer = await fetchStorageBuffer(payload.storageRef);
  if (!buffer.length) {
    throw new EdjProcessingError('STORAGE_NOT_FOUND', 'downloaded file is empty', true, 'fetching');
  }

  if (payload.storageRef.sha256) {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (hash !== payload.storageRef.sha256) {
      throw new EdjProcessingError('STORAGE_INTEGRITY', 'sha256 mismatch', false, 'fetching');
    }
  }

  const fileName = payload.storageRef.fileName || payload.storageRef.storageKey?.split('/').pop() || 'document.pdf';
  const mimeType = payload.storageRef.mimeType || 'application/octet-stream';

  await updateJobProgress(jobId, 'processing', 'parsing', 15);
  const extracted = await extractDocumentText({
    base64: buffer.toString('base64'),
    fileName,
    mimeType,
  });

  if (!extracted.text || extracted.text.trim().length < 20) {
    throw new EdjProcessingError('OCR_FAILED', 'no extractable text from document', true, 'parsing');
  }

  const nyvDocId = `doc_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  let storagePath =
    payload.storageRef.type === 'nyv_shared_key' && payload.storageRef.storageKey
      ? payload.storageRef.storageKey
      : `orgs/${orgId}/${platformCode.toLowerCase()}/users/${userId}/documents/${nyvDocId}/${fileName}`;

  if (payload.storageRef.type === 'presigned_get') {
    await nyvDocumentStorage.uploadRaw(storagePath, buffer, mimeType);
  }

  let chunksIndexed = 0;
  let embeddingsGenerated = 0;
  let graphNodesAdded = 0;

  const runRag = async () => {
    if (!enableRag) return;
    await updateJobProgress(jobId, 'processing', 'chunking', 35);
    const { nyvDocIntelligence } = await import('./jrx-document-intelligence-orchestrator.js');
    const pipeline = await nyvDocIntelligence.processDocument({
      docId: nyvDocId,
      orgId: String(orgId),
      platform: platformCode.toLowerCase(),
      userId,
      fileName,
      mimeType,
      storagePath,
      sha256Hash: crypto.createHash('sha256').update(buffer).digest('hex'),
      documentClass: 'user_document',
      jurisdiction: payload.jurisdiction ?? 'IN',
      language: payload.outputOptions?.languages?.[0] ?? 'en',
      namespaces: ['user_documents', 'org_shared'],
      chunkSize: 1200,
      // GraphRAG only for full intelligence — major latency saver on extraction.
      enableGraphRAG: profile === 'full_intelligence' && payload.outputOptions?.enableGraphRag !== false,
      extractedText: extracted.text,
      fileBuffer: buffer,
    });
    chunksIndexed = pipeline.chunksIndexed;
    embeddingsGenerated = pipeline.embeddingsGenerated;
    graphNodesAdded = pipeline.graphNodesAdded;

    await autoShareIfLarge({
      documentId: nyvDocId,
      ownerOrgId: String(orgId),
      ownerPlatformCode: platformCode as PlatformCode,
      fileSizeBytes: buffer.length,
      storagePath,
      triggeredBy: `edj:${jobId}`,
    }).catch(() => []);
  };

  let analysis: Record<string, unknown> = {};
  const runAnalysis = async () => {
    if (profile === 'ingest_only') return;
    await updateJobProgress(jobId, 'processing', 'analyzing', 70);
    const opts = analysisOptionsForProfile(
      profile,
      payload.outputOptions?.depth ?? payload.outputOptions?.detailLevel,
    );
    const pageCount = Math.max(1, Math.ceil(extracted.text.length / 3000));
    const result = await analyzeDocument(extracted.text, pageCount, opts, String(orgId));
    analysis = { ...result } as Record<string, unknown>;
  };

  // Parallelize RAG ingest ∥ analysis — analysis does not need the just-built index.
  await Promise.all([runRag(), runAnalysis()]);

  await updateJobProgress(jobId, 'processing', 'extracting', 85);
  const fields = await extractManifestFields(extracted.text, payload.fieldManifest, analysis, {
    orgId: String(orgId),
    platformCode,
  });

  // Persist raw extracted text in object storage for later retrieval via /content endpoint
  const rawTextStoragePath = `edj-content/${platformCode.toLowerCase()}/${orgId}/${jobId}/raw.txt`;
  try {
    await nyvDocumentStorage.uploadRaw(rawTextStoragePath, Buffer.from(extracted.text, 'utf-8'), 'text/plain');
  } catch (err: unknown) {
    logger.warn('edj_raw_text_persist_failed', { jobId, err: err instanceof Error ? err.message : String(err) });
  }

  const pageCount = Math.max(1, Math.ceil(extracted.text.length / 3000));
  const rawContent: EdjRawContent = {
    preview: extracted.text.slice(0, EDJ_RAW_CONTENT_PREVIEW_CHARS),
    charCount: extracted.text.length,
    wordCount: extracted.text.split(/\s+/).filter(Boolean).length,
    pageCount,
    contentUrl: `/api/jrx/v1/sdk/ecosystem-documents/jobs/${jobId}/content`,
    mimeType: 'text/plain',
    encoding: 'utf-8',
  };

  const envelope: EdjResultEnvelope = {
    jobId,
    platformCode,
    correlationId,
    ingest: {
      nyvDocId,
      chunksIndexed,
      embeddingsGenerated,
      graphNodesAdded,
      ragReady: enableRag && chunksIndexed > 0,
      storagePath,
    },
    rawContent,
    intelligence: profile === 'ingest_only' ? undefined : analysisToIntelligence(analysis),
    fields: Object.keys(fields).length ? fields : undefined,
    artifacts: {
      fullText: {
        ref: storagePath,
        pageCount,
      },
      rawText: {
        ref: rawTextStoragePath,
        pageCount,
      },
    },
    callbackMetadata: payload.delivery?.callbackMetadata,
  };

  await updateJobProgress(jobId, 'completed', 'completed', 100, { output: envelope });
  await deliverEdjWebhook(payload, 'document.job.completed', { status: 'completed', result: envelope });

  const legacyDoc = payload.legacyDocId ?? payload.delivery?.callbackMetadata?.nspDocumentId ?? payload.delivery?.callbackMetadata?.docId;
  await touchLegacyNsDocument(legacyDoc as string | number | undefined, 'completed', analysis);

  return envelope;
}

export async function failEcosystemDocumentJob(
  payload: EdjWorkerPayload,
  err: EdjProcessingError | Error,
): Promise<void> {
  const edjErr: EdjErrorBody =
    err instanceof EdjProcessingError
      ? { code: err.code, message: err.message, retryable: err.retryable, phase: err.phase }
      : { code: 'INTERNAL_ERROR', message: err.message, retryable: false };

  await db.execute(sql`
    UPDATE nv_schema.async_job_queue
    SET status = 'failed', error_message = ${edjErr.message}, output = ${JSON.stringify({ error: edjErr })},
        completed_at = NOW(), updated_at = NOW()
    WHERE job_id = ${payload.jobId}
  `);

  await deliverEdjWebhook(payload, 'document.job.failed', { status: 'failed', error: edjErr });

  const legacyDoc = payload.legacyDocId ?? payload.delivery?.callbackMetadata?.nspDocumentId;
  await touchLegacyNsDocument(legacyDoc as string | number | undefined, 'failed');
}
