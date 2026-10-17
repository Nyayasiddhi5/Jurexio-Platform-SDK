// JRX-NS-021 (2026-05-05): pre-existing strict-null violations cluster in this
// file. Runtime is unaffected (gateway runs via tsx). Opt out of strict-null
// for the v5.0.0 deploy gate; track follow-up cleanup in INV-CLEANUP-001.
/**
 * Legal Chat backend routes
 * ─────────────────────────────────────────────────────────────────────────────
 * Mounted at /api/jrx/legal-chat. Powers the admin Legal Chat dashboard inside
 * JRX Console. Access is gated to Superadmins and Superadmin-allocated SMEs.
 *
 * Endpoints
 * ─────────
 *   POST   /sessions                  create a new chat session
 *   GET    /sessions                  list sessions for current user
 *   GET    /sessions/:id              fetch session + messages
 *   POST   /upload                    upload doc into user namespace
 *   POST   /send                      run an orchestration; returns SSE
 *                                     of timeline events + LLM token stream
 *   GET    /timeline/:orchestrationId replay buffered timeline (SSE)
 *   POST   /feedback                  store SME rubric → sme_feedback;
 *                                     fires LLM-judge cross-check async
 *   POST   /replay/:orchestrationId   re-run with model/agent override
 *   GET    /agents                    list jurisdiction agents
 *   GET    /models                    proxy to router-stats catalog
 *   GET    /sme-allocations           list (Superadmin only)
 *   POST   /sme-allocations           grant SME access (Superadmin only)
 *   DELETE /sme-allocations/:id       revoke (Superadmin only)
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { pool as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'pool');
import { authenticateToken, type AuthRequest } from '../middleware/jrx-auth.js';
import { requireLegalChatAccess, requireSuperadmin, isSuperadmin, type LegalChatAuthRequest } from '../middleware/legal-chat-rbac.js';
import { createLogger } from '../utils/logger.js';
import { legalChatEventBus, publishTimeline, type LegalChatTimelineEvent } from '../services/legal-chat-event-bus.js';
import { extractTextFromSource, type SourceFormat } from '../services/jrx-document-converter-service.js';
import {
  queenOrchestrator,
  QueenLifecycleEmitter,
  type OrchestrationRequest,
} from '../orchestration/jrx-queen-orchestrator.js';
import { buildQueenPathQualityEnvelope } from '../orchestration/jrx-quality-envelope.js';
import { MODEL_CATALOG } from '../services/intelligent-router/model-catalog.js';
import { pickSequence } from '../services/intelligent-router/intelligent-router.js';
import { nvAICreditEnforcer } from '../services/jrx-ai-credit-enforcer.js';
import { estimatePromptTokens } from '../config/jrx-prompt-budget.js';
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';
import { getRequestUsage, claimRequestUsageForBilling } from '../utils/jrx-request-usage-context.js';
import {
  recallSmePreferences,
  storeSmeInteraction,
  applyRubricToMem0,
} from '../services/jrx-sme/jrx-sme-mem0-hooks.js';
import { ingestApprovedChatToRag } from '../services/jrx-sme-approved-rag-ingest.js';
import { applyPartnerPromptAlias, wantsPartnerDemoUnlimited } from '../utils/jrx-partner-platform.js';
import {
  enqueueTrainingPair,
  bumpEma,
} from '../services/jrx-sme/jrx-sme-grpo-redis-queue.js';
import path from 'path';
import fs from 'fs';

const logger = createLogger('./jrx-legal-chat-routes');
const router = Router();

/**
 * NV-LEGALCHAT-CREDIT-001 — completion-side term for the pre-spend estimate.
 *
 * The Queen fans out and synthesises, so a chat turn's completion spend is not one
 * model call. `/orchestrate` uses its resolved `maxTokens`; this route never sets
 * one (the Queen picks per leaf), so a fixed conservative allowance stands in for
 * it. Under-estimating here is the failure that matters: it lets a request through
 * a cap it will actually exceed.
 */
const LEGAL_CHAT_COMPLETION_TOKEN_ESTIMATE = Number(
  process.env.JRX_LEGAL_CHAT_COMPLETION_TOKEN_ESTIMATE || 16_384,
);

/**
 * NV-LEGALCHAT-CREDIT-001 — post-spend accounting, which is what makes the
 * pre-spend cap capable of firing at all.
 *
 * `nvAICreditEnforcer.enforce()` reads `getUsedToday()`, which sums
 * `nv_schema.ai_credit_usage`. Nothing on this path ever wrote a row there, so an
 * enforce() call alone would have been a permanent no-op: usedToday would stay 0
 * and neither the daily budget nor the hourly rate limit could ever trip. This is
 * the same loop `/orchestrate` closed in JRX-P1-ORCH-CORE-001 item D.
 *
 * Flag-gated on the same `creditRecord` flag (default ON outside dev/test so local
 * UAT without the credit tables is unchanged) and fully fail-soft.
 */
function recordLegalChatCredit(args: {
  userId: number;
  orgId?: string;
  tier: string;
  agentKey?: string;
  jurisdiction?: string;
  requestId: string;
  fallbackTokensIn: number;
  fallbackTokensOut: number;
  fallbackModel?: string;
}): boolean {
  if (!isJrxFeatureOn('creditRecord')) return false;
  try {
    const usage = getRequestUsage();
    const tokensIn = usage?.promptTokens ?? args.fallbackTokensIn;
    const tokensOut = usage?.completionTokens ?? args.fallbackTokensOut;
    const tokensUsed = Math.max(0, Math.floor(Number(tokensIn) + Number(tokensOut)));
    if (tokensUsed <= 0) return false;
    // NV-CREDIT-UNIVERSAL-001 — claim before writing so the response-finish
    // backstop does not bill this request a second time.
    if (!claimRequestUsageForBilling(usage)) return false;
    void nvAICreditEnforcer
      .record({
        userId: String(args.userId),
        orgId: args.orgId,
        tier: args.tier,
        tokensUsed,
        agentKey: args.agentKey || 'legal-chat',
        jurisdiction: args.jurisdiction,
        model: usage?.model ?? args.fallbackModel,
        requestId: args.requestId,
        costUsd: usage?.costUsd ?? 0,
      })
      .catch((e: unknown) =>
        logger.warn('legal-chat credit record failed (non-fatal)', { error: (e as Error).message }),
      );
    return true;
  } catch (e) {
    logger.warn('legal-chat credit record dispatch failed (non-fatal)', {
      error: (e as Error).message,
    });
    return false;
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.use(authenticateToken);
router.use(requireLegalChatAccess);

// task-260: typed helper that narrows pg/neon QueryResult.rows (declared
// optional on AnyPool) into a guaranteed array so call sites stop tripping
// TS18048. Real shape always has `rows`; the helper just makes that explicit.
type DbqRow = Record<string, any>;
const dbq = async (text: string, params?: ReadonlyArray<unknown>): Promise<{ rows: DbqRow[] }> => {
  const r = await db.query(text, params);
  return { rows: ((r as { rows?: DbqRow[] } | undefined)?.rows ?? []) as DbqRow[] };
};

// ─────────────────────────── Ownership helpers ─────────────────────────────
// Superadmins are always allowed. Otherwise, the owning user_id of the
// session (or — for orchestrations — the session that owns the orchestration)
// must match the caller.

async function assertSessionOwnership(req: Request, sessionId: string): Promise<boolean> {
  const authReq = req as AuthRequest;
  const userId = parseInt(String(authReq.user!.id), 10);
  if (isSuperadmin(req)) return true;
  if (!sessionId || typeof sessionId !== 'string') return false;
  try {
    const r = await dbq(
      `SELECT owner_user_id FROM legal_chat_sessions WHERE id = $1 LIMIT 1`,
      [sessionId],
    );
    if (!r.rows[0]) return false;
    return Number(r.rows[0].owner_user_id) === userId;
  } catch {
    return false;
  }
}

async function assertOrchestrationOwnership(req: Request, orchestrationId: string): Promise<boolean> {
  const authReq = req as AuthRequest;
  const userId = parseInt(String(authReq.user!.id), 10);
  if (isSuperadmin(req)) return true;
  if (!orchestrationId || typeof orchestrationId !== 'string') return false;
  try {
    // An orchestration belongs to the user who owns the session it was
    // recorded against. If no message was ever persisted (ad-hoc /send
    // with no sessionId), only Superadmins may access it.
    const r = await dbq(
      `SELECT s.owner_user_id
         FROM legal_chat_messages m
         JOIN legal_chat_sessions s ON s.id = m.session_id
        WHERE m.orchestration_id = $1
        LIMIT 1`,
      [orchestrationId],
    );
    if (!r.rows[0]) return false;
    return Number(r.rows[0].owner_user_id) === userId;
  } catch {
    return false;
  }
}

// ─────────────────────────── Sessions ───────────────────────────────────────

router.post('/sessions', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = parseInt(String(authReq.user!.id), 10);
  const orgId = authReq.user!.organizationId
    ? parseInt(String(authReq.user!.organizationId), 10) || null
    : null;
  const id = randomUUID();
  const { title, jurisdictions, tier, mode, preferences } = req.body || {};
  try {
    await dbq(
      `INSERT INTO legal_chat_sessions
         (id, owner_user_id, org_id, title, jurisdictions, tier, mode, preferences, last_used_at, created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,NOW(),NOW())`,
      [
        id,
        userId,
        orgId,
        title || 'New legal chat',
        JSON.stringify(jurisdictions ?? []),
        tier || 'pro',
        mode || 'chat',
        JSON.stringify(preferences ?? {}),
      ],
    );
    res.json({ ok: true, session: { id, ownerUserId: userId, title: title || 'New legal chat' } });
  } catch (err) {
    logger.error('create session failed', { error: (err as Error).message });
    res.status(500).json({ error: 'create session failed' });
  }
});

router.get('/sessions', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = parseInt(String(authReq.user!.id), 10);
  try {
    const r = await dbq(
      `SELECT id, title, jurisdictions, tier, mode, last_used_at, created_at
         FROM legal_chat_sessions
         WHERE owner_user_id = $1
         ORDER BY last_used_at DESC
         LIMIT 50`,
      [userId],
    );
    res.json({ ok: true, sessions: r.rows });
  } catch (err) {
    logger.error('list sessions failed', { error: (err as Error).message });
    res.status(500).json({ error: 'list sessions failed' });
  }
});

router.get('/sessions/:id', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = parseInt(String(authReq.user!.id), 10);
  try {
    const s = await dbq(
      `SELECT id, owner_user_id, title, jurisdictions, tier, mode, preferences,
              last_used_at, created_at
         FROM legal_chat_sessions WHERE id = $1`,
      [req.params.id],
    );
    if (!s.rows.length) { res.status(404).json({ error: 'not found' }); return; }
    if (s.rows[0].owner_user_id !== userId && (authReq as LegalChatAuthRequest).legalChatRole !== 'admin') {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const m = await dbq(
      `SELECT id, role, content, citations, metadata, orchestration_id, created_at
         FROM legal_chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
      [req.params.id],
    );
    res.json({ ok: true, session: s.rows[0], messages: m.rows });
  } catch (err) {
    logger.error('get session failed', { error: (err as Error).message });
    res.status(500).json({ error: 'get session failed' });
  }
});

// ─────────────────────────── Uploads ────────────────────────────────────────

const UPLOAD_DIR = process.env.JRX_LEGAL_CHAT_UPLOAD_DIR || '/tmp/jrx-legal-chat-uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ─── Attachment extraction (NV-LEGALCHAT-ATTACHMENTS-2026-05-12) ──────────
//
// LegalChat uploads are written to UPLOAD_DIR as `${id}__${safeName}`. When
// /send receives `fileIds[]` we resolve each id back to a file on disk,
// pick the right extractor (mammoth/pdf-parse/xlsx/tesseract/utf8) and
// inject the extracted text into the prompt before it reaches the Queen.
// This is the same UX as ChatGPT/Claude/Gemini: drag-drop a doc → it
// becomes context for the next turn.

const EXT_TO_FORMAT: Record<string, SourceFormat> = {
  pdf: 'pdf', docx: 'docx', xlsx: 'xlsx', md: 'md', pptx: 'pptx',
  txt: 'txt', html: 'html', htm: 'html', rtf: 'rtf', csv: 'csv',
  odt: 'odt', json: 'txt',
};
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'tiff', 'bmp', 'gif']);
const PER_FILE_TEXT_CAP = 60_000;

async function extractAttachmentText(fileId: string): Promise<{ name: string; text: string; bytes: number } | null> {
  let entries: string[];
  try { entries = await fs.promises.readdir(UPLOAD_DIR); } catch { return null; }
  const match = entries.find((f) => f.startsWith(`${fileId}__`));
  if (!match) return null;
  const fullPath = path.join(UPLOAD_DIR, match);
  const name = match.slice(fileId.length + 2);
  const ext = (name.split('.').pop() || '').toLowerCase();
  let stat: { size: number };
  try { stat = await fs.promises.stat(fullPath); } catch { return null; }
  try {
    if (IMAGE_EXTS.has(ext)) {
      try {
        const tess: any = await import('tesseract.js');
        const recognize = tess.default?.recognize || tess.recognize;
        const result = await recognize(fullPath, 'eng');
        const text = String(result?.data?.text || '').trim();
        return { name, text: text || `[image: ${name} — no text recognized]`, bytes: stat.size };
      } catch (err) {
        return { name, text: `[image attachment: ${name} — OCR unavailable: ${(err as Error).message}]`, bytes: stat.size };
      }
    }
    const fmt = EXT_TO_FORMAT[ext];
    if (fmt) {
      const text = await extractTextFromSource({ path: fullPath }, fmt);
      return { name, text, bytes: stat.size };
    }
    const text = await fs.promises.readFile(fullPath, 'utf8');
    return { name, text, bytes: stat.size };
  } catch (err) {
    logger.warn('attachment extract failed', { fileId, error: (err as Error).message });
    return { name, text: `[failed to extract ${name}: ${(err as Error).message}]`, bytes: stat.size };
  }
}

async function buildPromptWithAttachments(prompt: string, fileIds: string[] | undefined):
  Promise<{ prompt: string; attachments: Array<{ id: string; name: string; bytes: number; chars: number }> }> {
  const ids = Array.isArray(fileIds) ? fileIds.filter(Boolean) : [];
  if (!ids.length) return { prompt, attachments: [] };
  const blocks: string[] = [];
  const meta: Array<{ id: string; name: string; bytes: number; chars: number }> = [];
  for (const id of ids) {
    const r = await extractAttachmentText(id);
    if (!r) continue;
    const clipped = (r.text || '').slice(0, PER_FILE_TEXT_CAP);
    blocks.push(`### ATTACHED DOCUMENT: ${r.name}\n${clipped}`);
    meta.push({ id, name: r.name, bytes: r.bytes, chars: clipped.length });
  }
  if (!blocks.length) return { prompt, attachments: [] };
  const augmented =
    `# USER QUESTION\n${prompt}\n\n` +
    `# ATTACHMENTS (${blocks.length})\n` +
    `The user attached ${blocks.length} document(s) below. Use them as primary context when answering. Cite filenames where relevant.\n\n` +
    blocks.join('\n\n---\n\n');
  return { prompt: augmented, attachments: meta };
}

router.post('/upload', upload.array('files', 10), async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = parseInt(String(authReq.user!.id), 10);
  const files = (req.files as Express.Multer.File[]) || [];
  if (!files.length) { res.status(400).json({ error: 'no files' }); return; }
  const stored: Array<{ id: string; name: string; size: number; namespace: string }> = [];
  const namespace = `user:${authReq.user!.organizationId ?? 'noorg'}:${userId}:legal-chat`;
  for (const f of files) {
    const id = randomUUID();
    const safe = f.originalname.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
    const dest = path.join(UPLOAD_DIR, `${id}__${safe}`);
    fs.writeFileSync(dest, f.buffer);
    stored.push({ id, name: f.originalname, size: f.size, namespace });
  }
  res.json({ ok: true, files: stored });
});

// ─────────────────────────── Send (SSE) ─────────────────────────────────────
//
// POST /send body: {
//   sessionId, prompt, jurisdictions[], tier, agentId, preferredModel,
//   preferCheaper, requireReasoning, requireJson, requireVision,
//   mode, fileIds?, swarmTopology?, taskKind?
// }
// Returns: SSE stream. Each event line is JSON. The first event always
// carries `step: "request_received"` with the orchestrationId so the client
// can persist + later POST feedback.

router.post('/send', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = parseInt(String(authReq.user!.id), 10);
  const body = req.body || {};
  const resolvedPrompt = applyPartnerPromptAlias(body);
  if (!resolvedPrompt) {
    return void res.status(400).json({
      success: false,
      error: 'prompt is required',
      code: 'BAD_REQUEST',
    });
  }
  const orchestrationId = `orch_${randomUUID()}`;
  const startedAt = Date.now();

  // Ownership gate: if a sessionId is supplied, it MUST belong to this user
  // (or this user must be a Superadmin). Stops cross-user message poisoning
  // via guessable / leaked session UUIDs.
  if (body.sessionId) {
    if (!(await assertSessionOwnership(req, body.sessionId))) {
      return void res.status(403).json({ error: 'session does not belong to caller' });
    }
  }

  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (event: LegalChatTimelineEvent) => {
    publishTimeline(event);
    res.write(`event: ${event.step}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const closed = { v: false };
  req.on('close', () => { closed.v = true; });

  try {
    send({
      orchestrationId,
      step: 'request_received',
      status: 'ok',
      ts: Date.now(),
      data: {
        sessionId: body.sessionId,
        userId,
        prompt: typeof body.prompt === 'string' ? body.prompt.slice(0, 200) : '',
        jurisdictions: body.jurisdictions ?? [],
        tier: body.tier ?? 'pro',
        agentId: body.agentId,
        preferredModel: body.preferredModel,
        mode: body.mode ?? 'chat',
        topology: body.swarmTopology,
      },
    });

    // Cheap local PII scan announcement (full PII pipeline runs deeper inside Queen)
    send({
      orchestrationId,
      step: 'pii_redaction',
      status: 'running',
      ts: Date.now(),
      data: { strategy: 'pre-orchestrate', note: 'platform PII pipeline runs inside Queen' },
    });

    // Step 3 — session_persisted. Distinct from request_received: confirms
    // the session row exists/was reused so feedback ownership will resolve.
    if (body.sessionId) {
      send({
        orchestrationId,
        step: 'session_persisted',
        status: 'ok',
        ts: Date.now(),
        data: { sessionId: body.sessionId, mode: 'reuse' },
      });
    } else {
      send({
        orchestrationId,
        step: 'session_persisted',
        status: 'skipped',
        ts: Date.now(),
        data: { reason: 'no sessionId on request — ad-hoc orchestration' },
      });
    }

    // Step 6 — rag_retrieval. Surfaces the multi-tier RAG fan-out the
    // Queen will execute. Real chunk metadata is filled in post-orchestrate
    // from r?.metadata?.rag if the orchestrator surfaces it; otherwise we
    // emit a `running` placeholder + a final `ok` after orchestration.
    send({
      orchestrationId,
      step: 'rag_retrieval',
      status: 'running',
      ts: Date.now(),
      data: { tiers: ['vector', 'graphrag', 'memory'], note: 'queen-driven multi-tier fan-out' },
    });

    // Show what the router would pick BEFORE we hand off — this is the
    // workflow visualizer's headline insight.
    const routingPreview = pickSequence({
      agentId: body.agentId,
      tier: body.tier,
      jurisdiction: Array.isArray(body.jurisdictions) ? body.jurisdictions[0] : body.jurisdictions,
      taskKind: body.taskKind ?? mapModeToTaskKind(body.mode),
      preferCheaper: !!body.preferCheaper,
      requireReasoning: !!body.requireReasoning,
      requireJson: !!body.requireJson,
      requireVision: !!body.requireVision,
      preferredModels: body.preferredModel ? [body.preferredModel] : undefined,
    });
    send({
      orchestrationId,
      step: 'router_decision',
      status: 'ok',
      ts: Date.now(),
      data: {
        primary: routingPreview.primary?.id,
        primaryProvider: routingPreview.primary?.provider,
        sequence: routingPreview.sequence.map((m: any) => ({
          id: m.id, provider: m.provider, ctx: m.ctx, costInPer1M: m.costInPer1M,
        })).slice(0, 8),
        inputs: routingPreview.inputs,
      },
    });

    // Build a per-orchestration emitter and bridge Queen events → bus.
    const queenEmitter = new QueenLifecycleEmitter();
    queenEmitter.on('decomposition_complete', (e: any) => {
      send({
        orchestrationId,
        step: 'agent_selection',
        status: 'ok',
        ts: Date.now(),
        data: {
          tasks: e?.subtaskCount ?? e?.tasks?.length,
          summary: e?.summary,
          algorithm: e?.algorithm,
          pattern: e?.pattern,
          complexity: e?.complexity,
          subtasks: e?.subtasks,
        },
      });
    });
    queenEmitter.on('agent_started', (e: any) => {
      send({
        orchestrationId,
        step: 'prompt_compiled',
        status: 'running',
        ts: Date.now(),
        data: {
          agentId: e?.agentId,
          agentName: e?.agentName,
          taskId: e?.subtaskId ?? e?.taskId,
          subtaskType: e?.subtaskType,
          description: e?.description,
          romaLevel: e?.romaLevel,
        },
      });
    });
    queenEmitter.on('agent_completed', (e: any) => {
      send({
        orchestrationId,
        step: 'llm_stream_completed',
        status: 'ok',
        ts: Date.now(),
        durationMs: e?.durationMs,
        data: {
          agentId: e?.agentId,
          tokensIn: e?.tokensIn,
          tokensOut: e?.tokensOut,
          model: e?.model,
        },
      });
    });
    queenEmitter.on('agent_failed', (e: any) => {
      send({
        orchestrationId,
        step: 'llm_stream_completed',
        status: 'failed',
        ts: Date.now(),
        message: e?.error,
        data: { agentId: e?.agentId },
      });
    });
    queenEmitter.on('synthesis_started', () => {
      send({ orchestrationId, step: 'llm_stream_started', status: 'running', ts: Date.now() });
    });
    queenEmitter.on('synthesis_complete', (e: any) => {
      send({
        orchestrationId,
        step: 'llm_stream_completed',
        status: 'ok',
        ts: Date.now(),
        data: { chars: e?.responseLength, model: e?.model },
      });
    });

    // Task #156 — SME pre-recall: pull this SME's preference memories
    // (6th tier, alongside the platform's existing 5 memory tiers) and
    // surface them to the orchestrator via metadata.smePreferenceContext.
    // Non-blocking on failure (returns empty context).
    //
    // SME-mode is AUTHORIZATION-DRIVEN, never client-asserted: only a
    // user whose backend role is 'sme' (or who is a Superadmin acting
    // on behalf of SME ops) gets the forceMakerChecker + mem0 path.
    // body.mode/smeContext are ignored here so non-SME callers cannot
    // escalate into SME-only processing.
    const userRole = String(authReq.user?.role || '').toLowerCase();
    const shellHeader = String(req.headers['x-jrx-shell'] || '').toLowerCase();
    // Authorization gate: SME path is role-gated. Header/mode are SIGNALS,
    // not authorization — non-superadmin, non-SME callers cannot escalate
    // into SME-only processing by setting X-NV-Shell or body.mode.
    const isSmeRun =
      userRole === 'sme' ||
      (isSuperadmin(req) && (shellHeader === 'sme' || body.mode === 'sme'));
    let smeContext: { hits: number; facts: string[]; recent: Array<{ content: string; score: number; ts: string }> } | undefined;
    if (isSmeRun) {
      smeContext = await recallSmePreferences({
        smeUserId: userId,
        jurisdiction: (Array.isArray(body.jurisdictions) ? body.jurisdictions[0] : body.jurisdictions) || 'GLOBAL',
        prompt: String(body.prompt || ''),
        topK: 5,
      });
    }
    send({
      orchestrationId,
      step: 'memory_injection',
      status: 'ok',
      ts: Date.now(),
      data: {
        source: isSmeRun ? 'mem0:sme+l1-l5' : 'l1-l5',
        tiers: ['L1-working/episodic', 'L2-matter', 'L3-client', 'L4-jurisdictional', 'L5-precedent'],
        mem0: Boolean(smeContext),
        hits: smeContext?.hits ?? 0,
        facts: smeContext?.facts?.length ?? 0,
      },
    });

    // NV-LEGALCHAT-ATTACHMENTS-2026-05-12: extract text from any uploaded
    // files and inline into the prompt before the Queen runs. Surface the
    // attachment manifest as its own timeline event for the dashboard.
    const { prompt: augmentedPrompt, attachments } =
      await buildPromptWithAttachments(String(body.prompt || ''), body.fileIds);
    if (attachments.length) {
      send({
        orchestrationId,
        step: 'attachments_extracted',
        status: 'ok',
        ts: Date.now(),
        data: {
          count: attachments.length,
          totalChars: attachments.reduce((s, a) => s + a.chars, 0),
          files: attachments,
        },
      });
    }

    // task-260: replace the prior `as unknown as OrchestrationRequest`
    // double-cast with a properly typed local extension. The Queen's
    // OrchestrationRequest is declared lean (prompt/userId/jurisdiction/
    // tier/lifecycleEvents/...); legal-chat additionally needs requestId,
    // organizationId, agentId and a custom `metadata` envelope for the
    // workflow visualizer + audit chain. Modelling that as a sub-interface
    // keeps the queen-side contract intact while giving us field-by-field
    // type checking on the construction below. The orchestrate() call
    // accepts `LegalChatQueenRequest` because every required parent field
    // is present.
    interface LegalChatQueenRequest extends OrchestrationRequest {
      requestId: string;
      organizationId?: string;
      agentId?: string;
      metadata: {
        source: string;
        sessionId?: string;
        mode?: string;
        preferredModel?: string;
        forceMakerChecker: boolean;
        perNodeTimeoutMs?: number;
        smePreferenceContext: typeof smeContext;
      };
    }
    const queenRequest: LegalChatQueenRequest = {
      orchestrationId,
      requestId: orchestrationId,
      prompt: augmentedPrompt,
      type: 'general',
      userId: String(userId),
      organizationId: authReq.user!.organizationId
        ? String(authReq.user!.organizationId)
        : undefined,
      jurisdiction: Array.isArray(body.jurisdictions) ? body.jurisdictions[0] : body.jurisdictions,
      tier: body.tier ?? 'pro',
      agentId: body.agentId,
      lifecycleEvents: queenEmitter,
      // NV-SME-PARALLEL-001 (2026-06-18): SME runs force maker-checker + fan out
      // to multiple independent specialist agents. Running those sequentially
      // pushed total latency past ~290s (smoke client/edge timeout). Force
      // `parallel` so the independent agents execute concurrently (bounded by the
      // tier's maxConcurrentNodes), and raise the per-node wall budget so a slow
      // Opus+maker-checker node isn't cut at the default 90s cap. Non-SME runs
      // keep the Queen's auto-selected pattern.
      ...(isSmeRun ? { orchestrationMode: 'parallel' as const } : {}),
      metadata: {
        source: isSmeRun ? 'console:sme-legal-chat' : 'console:legal-chat',
        sessionId: body.sessionId,
        mode: body.mode,
        preferredModel: body.preferredModel,
        // Task #156 — SME runs force CAM/maker-checker on regardless of
        // global gov flag. Honored by maybeRunMakerCheckerLoop in
        // jrx-queen-orchestrator.ts.
        forceMakerChecker: isSmeRun,
        ...(isSmeRun ? { perNodeTimeoutMs: 240_000 } : {}),
        smePreferenceContext: smeContext,
      },
      ...(body.sessionId ? { sessionId: body.sessionId } : {}),
    };

    /* ── NV-LEGALCHAT-CREDIT-001 — pre-spend AI-credit cap ─────────────────
     *
     * `/api/jrx/orchestrate` has enforced this since NV-B2 (T002); this path did
     * not, so the busiest interactive surface was the only one whose spend was
     * uncapped. Same enforcer (NV-NO-DUPLICATE-001), same lifecycle point (before
     * the model is called), same fail-soft posture as `/orchestrate`: an enforcer
     * that throws must never block a lawyer's answer, so the failure is logged and
     * the run proceeds — but the quality envelope then reports `consent_credits`
     * as NOT enforced, so an unenforced request is visible rather than assumed.
     *
     * `estimatedTokens` prices the prompt we will actually send (attachments
     * included), matching `/orchestrate`'s NV-INLINE-DOC-PROMPT-001 reasoning: a
     * 60 KB attached contract is the dominant term and estimating on the bare
     * question would wave it past a cap it exceeds. */
    const creditTier = String(body.tier ?? 'pro');
    let creditsPreSpendEnforced = false;
    try {
      const creditCheck = await nvAICreditEnforcer.enforce({
        userId: String(userId),
        orgId: authReq.user!.organizationId ? String(authReq.user!.organizationId) : undefined,
        tier: creditTier,
        estimatedTokens: Math.min(estimatePromptTokens(augmentedPrompt) + LEGAL_CHAT_COMPLETION_TOKEN_ESTIMATE, 200_000),
        agentKey: body.agentId || 'legal-chat',
        bypassCaps: wantsPartnerDemoUnlimited(req),
      });
      creditsPreSpendEnforced = true;
      if (!creditCheck.allowed) {
        /* Matches `/orchestrate/stream`: a terminal SSE error event, no model
         * spend. The sync `/orchestrate` route answers HTTP 429
         * RATE_LIMIT_EXCEEDED; on an already-open event stream the equivalent is
         * this event with the same `CREDIT_CAP_EXCEEDED` code, so a partner
         * branches on one code across both surfaces. */
        send({
          orchestrationId,
          step: 'run_failed',
          status: 'failed',
          ts: Date.now(),
          durationMs: Date.now() - startedAt,
          message: creditCheck.reason || 'AI token budget exceeded',
          data: {
            error: 'CREDIT_CAP_EXCEEDED',
            code: 'CREDIT_CAP_EXCEEDED',
            reason: creditCheck.reason,
            tier: creditCheck.tier,
            budgetLimit: creditCheck.budgetLimit,
            usedToday: creditCheck.usedToday,
            remainingToday: creditCheck.remainingToday,
            retryAfterSeconds: creditCheck.retryAfterSeconds ?? 3600,
          },
        });
        return;
      }
    } catch (creditErr) {
      logger.warn('legal-chat credit check failed (non-fatal)', {
        orchestrationId,
        error: (creditErr as Error).message,
      });
    }

    const result = await queenOrchestrator.orchestrate(queenRequest);
    const r: any = result;
    // Queen returns { synthesizedOutput, metadata: { totalTokens, totalTime,
    //   agentsUsed, orchestrationPattern }, executions[], taskDecomposition,
    //   citations?, safetyVerdict?, auditEntryHash?, success }.
    const safetyBlocked = r?.safetyVerdict?.verdict === 'block';
    const rawResponse: string =
      r?.synthesizedOutput ?? r?.response ?? r?.synthesis ?? '';
    // Safety enforcement: when the verdict is block, redact the response
    // body and citations. Persisted message + run_complete payload both
    // get the redacted version. The reason is still surfaced.
    const responseText: string = safetyBlocked
      ? `[BLOCKED BY SAFETY POLICY] ${r?.safetyVerdict?.reason || 'response withheld'}`
      : rawResponse;
    const citations = safetyBlocked ? [] : (r?.citations ?? r?.metadata?.citations ?? []);
    const model = r?.metadata?.model ?? r?.executions?.[0]?.model ?? 'multi-agent';
    const tokensIn = r?.metadata?.totalTokens?.input ?? 0;
    const tokensOut = r?.metadata?.totalTokens?.output ?? 0;

    if (body.sessionId) {
      try {
        await dbq(
          `INSERT INTO legal_chat_messages
             (id, session_id, orchestration_id, role, content, citations, metadata, created_at)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,NOW())`,
          [
            randomUUID(),
            body.sessionId,
            orchestrationId,
            'assistant',
            responseText,
            JSON.stringify(citations),
            JSON.stringify({
              model, tokensIn, tokensOut,
              safetyBlocked,
              safetyReason: safetyBlocked ? r?.safetyVerdict?.reason : undefined,
              agentsUsed: r?.metadata?.agentsUsed,
              orchestrationPattern: r?.metadata?.orchestrationPattern,
              latencyMs: Date.now() - startedAt,
            }),
          ],
        );
        await dbq(
          `UPDATE legal_chat_sessions SET last_used_at = NOW() WHERE id = $1`,
          [body.sessionId],
        );
        // Step 15 — response_persisted. Confirms the assistant message row
        // landed in legal_chat_messages so SMEs can rate it.
        send({
          orchestrationId,
          step: 'response_persisted',
          status: 'ok',
          ts: Date.now(),
          data: { sessionId: body.sessionId, chars: responseText.length, citations: Array.isArray(citations) ? citations.length : 0 },
        });
      } catch (err) {
        logger.warn('persist message failed', { error: (err as Error).message });
        send({
          orchestrationId,
          step: 'response_persisted',
          status: 'failed',
          ts: Date.now(),
          message: (err as Error).message,
        });
      }
    } else {
      send({
        orchestrationId,
        step: 'response_persisted',
        status: 'skipped',
        ts: Date.now(),
        data: { reason: 'no sessionId — ad-hoc run, not persisted' },
      });
    }

    /* Step 6 (resolve) — rag_retrieval, from the Queen's MEASURED Step-0 outcome.
     *
     * NV-LEGALCHAT-RAG-EVENT-001: this read `r.metadata.rag ?? r.ragSummary`, and
     * the Queen populates neither. So the event had no data source and had always
     * reported `chunks: 0, status: 'ok'` — a client watching it concluded retrieval
     * ran and found nothing, which is a different (and much more alarming) claim
     * than "we captured nothing about retrieval".
     *
     * The real source is `metadata.ragStep0`, stamped by the Queen after Step-0
     * Auto-RAG. Three outcomes, each reported distinguishably, because collapsing
     * them is the whole defect:
     *   - no evidence at all      → status 'skipped', chunks null, evidence 'absent'
     *   - measured, count unknown → status 'failed', chunks null (retrieval timed
     *                               out or threw; the count was never observed)
     *   - measured               → status 'ok', chunks is the real number, and
     *                              `retrieved: false` when that number is 0
     * `chunks` is never 0 unless a retrieval really returned zero chunks. */
    const ragStep0 = r?.metadata?.ragStep0 as
      | {
          attempted: boolean;
          grounded: boolean;
          timedOut: boolean;
          chunkCount?: number;
          layersUsed?: string[];
          retrievalMethods?: string[];
          intent?: string;
        }
      | undefined;
    const ragCountMeasured = typeof ragStep0?.chunkCount === 'number';
    send({
      orchestrationId,
      step: 'rag_retrieval',
      status: !ragStep0 ? 'skipped' : ragCountMeasured ? 'ok' : 'failed',
      ts: Date.now(),
      data: !ragStep0
        ? {
            evidence: 'absent',
            source: 'queen.metadata.ragStep0',
            chunks: null,
            retrieved: null,
            reason:
              'the Queen surfaced no Step-0 retrieval evidence for this run — retrieval outcome unknown, not zero',
          }
        : {
            evidence: 'measured',
            source: 'queen.step0.autoRag',
            attempted: ragStep0.attempted === true,
            chunks: ragCountMeasured ? ragStep0.chunkCount : null,
            retrieved: ragCountMeasured ? (ragStep0.chunkCount as number) > 0 : null,
            grounded: ragStep0.grounded === true,
            timedOut: ragStep0.timedOut === true,
            layersUsed: ragStep0.layersUsed ?? [],
            retrievalMethods: ragStep0.retrievalMethods ?? [],
            intent: ragStep0.intent,
            ...(ragCountMeasured
              ? {}
              : {
                  reason: ragStep0.timedOut
                    ? 'Step-0 retrieval timed out — chunk count never observed'
                    : 'Step-0 retrieval did not return a result — chunk count never observed',
                }),
          },
    });

    // Step 12-pre — maker_checker (CAM). Always emit so the SME UI shows
    // the gate explicitly; status reflects whether forceMakerChecker fired.
    const cam = r?.makerCheckerResult ?? r?.metadata?.makerChecker;
    send({
      orchestrationId,
      step: 'maker_checker',
      status: isSmeRun ? (cam?.passed === false ? 'blocked' : 'ok') : 'skipped',
      ts: Date.now(),
      data: {
        forced: isSmeRun,
        passed: cam?.passed,
        score: cam?.score,
        checkerNotes: cam?.notes,
        fallback: cam?.fallback,
      },
    });

    send({
      orchestrationId,
      step: 'safety_verdict',
      status: safetyBlocked ? 'blocked' : 'ok',
      ts: Date.now(),
      data: r?.safetyVerdict ?? { verdict: 'allow', source: 'queen-default' },
    });

    // Step 13 — citation_grounding. Surfaces grounding metrics from the
    // verifier (citation count + grounded ratio + missing/unverifiable).
    const grounding = r?.metadata?.grounding ?? r?.groundingResult ?? {};
    send({
      orchestrationId,
      step: 'citation_grounding',
      status: (grounding.unverifiable && grounding.unverifiable > 0) ? 'failed' : 'ok',
      ts: Date.now(),
      data: {
        citationCount: Array.isArray(citations) ? citations.length : 0,
        groundedRatio: grounding.groundedRatio,
        verified: grounding.verified,
        unverifiable: grounding.unverifiable,
      },
    });

    send({
      orchestrationId,
      step: 'audit_chain',
      status: 'ok',
      ts: Date.now(),
      data: {
        entryHash: r?.auditEntryHash,
        prevHash: r?.auditPrevHash,
        agentsUsed: r?.metadata?.agentsUsed,
        pattern: r?.metadata?.orchestrationPattern,
      },
    });
    const jurisdiction = Array.isArray(body.jurisdictions) ? body.jurisdictions[0] : body.jurisdictions;
    const creditsMeteredPostHoc = recordLegalChatCredit({
      userId,
      orgId: authReq.user!.organizationId ? String(authReq.user!.organizationId) : undefined,
      tier: creditTier,
      agentKey: body.agentId || 'legal-chat',
      jurisdiction,
      requestId: orchestrationId,
      fallbackTokensIn: Number(tokensIn) || 0,
      fallbackTokensOut: Number(tokensOut) || 0,
      fallbackModel: String(model),
    });

    /* NV-LEGALCHAT-QE-001 — this route drives the Queen directly, so it never
     * ran the route-level gates that `/api/jrx/orchestrate` applies after
     * orchestration. Build the envelope from what MEASURABLY ran: the Queen
     * middleware ring's own `stagesRun`, Step-0 RAG, and the gates this route
     * performed itself. Gates with no evidence stay unmarked and surface in
     * `missingMandatory` — an honest gap is the deliverable here, not a tick. */
    const qualityEnvelope = buildQueenPathQualityEnvelope({
      requestId: orchestrationId,
      risk: isSmeRun ? 'high' : 'medium',
      requireCoT: false,
      requireMakerChecker: isSmeRun,
      requireHitlScaled: isSmeRun,
      ingressGates: {
        identityVerified: true,
        taskClassified: true,
        jurisdictionResolved: true,
      },
      creditsPreSpendEnforced,
      creditsMeteredPostHoc,
      safetyStagesRun: Array.isArray(r?.metadata?.safetyStagesRun)
        ? r.metadata.safetyStagesRun
        : undefined,
      ragStep0,
      llmRouted: !!String(rawResponse || '').trim(),
      cotRan: !!r?.metadata?.queenCotApplied,
      makerCheckerRan: cam?.passed === true,
      hitlRan: !!r?.safetyVerdict?.details?.hitlReviewId,
      responseFormatted: !!String(responseText || '').trim(),
      meteringRan: false,
    });

    send({
      orchestrationId,
      step: 'run_complete',
      status: safetyBlocked ? 'blocked' : 'ok',
      ts: Date.now(),
      durationMs: Date.now() - startedAt,
      data: {
        response: responseText,
        citations,
        model,
        tokensIn,
        tokensOut,
        safetyBlocked,
        agentsUsed: r?.metadata?.agentsUsed,
        qualityEnvelope,
      },
    });

    // Task #156 — SME post-store into mem0 (6th preference tier).
    // Fire-and-forget: an SME run completes regardless of mem0 health.
    if (isSmeRun && !safetyBlocked && responseText) {
      void storeSmeInteraction({
        smeUserId: userId,
        jurisdiction: (Array.isArray(body.jurisdictions) ? body.jurisdictions[0] : body.jurisdictions) || 'GLOBAL',
        taskKind: body.taskKind ?? mapModeToTaskKind(body.mode),
        model: String(model),
        prompt: String(body.prompt || ''),
        response: String(responseText),
        orchestrationId,
        citations: Array.isArray(citations) ? citations : [],
      }).catch(() => { /* best-effort */ });
    }
  } catch (err) {
    logger.error('legal-chat /send failed', { orchestrationId, error: (err as Error).message });
    send({
      orchestrationId,
      step: 'run_failed',
      status: 'failed',
      ts: Date.now(),
      durationMs: Date.now() - startedAt,
      message: (err as Error).message,
    });
  } finally {
    if (!closed.v) {
      try { res.end(); } catch { /* ignore */ }
    }
  }
});

// ─────────────────────────── Timeline replay (SSE) ──────────────────────────

router.get('/timeline/:orchestrationId', async (req: Request, res: Response) => {
  const id = req.params.orchestrationId;
  // Ownership gate: only the orchestration owner (via session ownership) or
  // a Superadmin may subscribe to a timeline. Anonymous subscribers with a
  // guessed orchestrationId are denied. If the orchestration was run with
  // NO sessionId (ad-hoc / one-shot) the only legitimate subscribers are
  // the original SSE caller of /send (already streaming live) and
  // Superadmins; so we deny here.
  if (!(await assertOrchestrationOwnership(req, String(id ?? "")))) {
    return void res.status(403).json({ error: 'orchestration does not belong to caller' });
  }
  // ?snapshot=1 returns the buffered timeline as JSON instead of opening
  // an SSE stream — used by WorkflowPane "Replay (server)" so the client
  // re-renders the canonical buffered events even after the SSE stream
  // closed (NV-REPLAY-TIMELINE-001).
  if (req.query.snapshot === '1' || req.query.snapshot === 'true') {
    const events = legalChatEventBus.snapshot(String(id ?? ""));
    return void res.json({ ok: true, orchestrationId: id, count: events.length, events });
  }
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  let unsub = () => {};
  const send = (e: LegalChatTimelineEvent) => {
    res.write(`event: ${e.step}\n`);
    res.write(`data: ${JSON.stringify(e)}\n\n`);
    if (e.step === 'run_complete' || e.step === 'run_failed') {
      try { unsub(); } catch { /* */ }
      try { res.end(); } catch { /* */ }
    }
  };
  unsub = legalChatEventBus.subscribe(String(id ?? ""), send);
  req.on('close', () => { try { unsub(); } catch { /* */ } });
  if (legalChatEventBus.isDone(String(id ?? ""))) {
    try { unsub(); } catch { /* */ }
    try { res.end(); } catch { /* */ }
  }
});

// ─────────────────────────── Feedback (rubric → GRPO) ───────────────────────

router.post('/feedback', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = parseInt(String(authReq.user!.id), 10);
  const { orchestrationId, sessionId, ratings, comment, preferredOver } = req.body || {};
  if (!orchestrationId) { res.status(400).json({ error: 'orchestrationId required' }); return; }
  // Ownership gate: SME/Superadmin may only score orchestrations they
  // either own (their session) or are Superadmin for. This stops one
  // SME from rating another SME's runs (rubric poisoning).
  if (!(await assertOrchestrationOwnership(req, orchestrationId))) {
    res.status(403).json({ error: 'orchestration not eligible for feedback by this user' });
    return;
  }
  if (sessionId && !(await assertSessionOwnership(req, sessionId))) {
    res.status(403).json({ error: 'session does not belong to caller' });
    return;
  }
  try {
    const r = await dbq(
      `INSERT INTO sme_feedback
         (orchestration_id, session_id, sme_user_id, ratings, comment, preferred_over, created_at)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,NOW())
       RETURNING id`,
      [
        orchestrationId,
        sessionId || null,
        userId,
        JSON.stringify(ratings ?? {}),
        comment ?? null,
        preferredOver ?? null,
      ],
    );
    // Best-effort async LLM-judge cross-check; non-blocking.
    void runJudgeCrosscheck(r.rows[0].id, orchestrationId).catch((err: any) =>
      logger.warn('judge cross-check failed', {
        feedbackId: r.rows[0].id, error: (err as Error).message,
      }),
    );
    // Task #156 — Redis GRPO training queue + EMA bump + mem0 reinforce.
    // All best-effort: Postgres remains the durable source of truth.
    const feedbackId = r.rows[0].id;
    await enqueueGrpoSignals({
      feedbackId,
      orchestrationId,
      smeUserId: userId,
      sessionId,
      ratings: ratings ?? {},
      comment,
      preferredOver,
    }).catch((err) =>
      logger.warn('grpo signals enqueue failed', { error: (err as Error).message }),
    );

    res.json({ ok: true, feedbackId });
  } catch (err) {
    logger.error('feedback insert failed', { error: (err as Error).message });
    res.status(500).json({ error: 'feedback persist failed' });
  }
});

// Task #156 — joins the rubric verdict with the prior orchestration's
// (jurisdiction, taskKind, model, prompt, response) so we can: (a) write
// a Postgres GRPO preference row, (b) XADD the Redis training stream,
// (c) bump the per-(j,task,model) EMA hash for future router tie-breakers,
// (d) reinforce/forget the matching mem0 entries. Pure side-effect helper.
async function enqueueGrpoSignals(opts: {
  feedbackId: number | string;
  orchestrationId: string;
  smeUserId: number;
  sessionId?: string | null;
  ratings: Record<string, unknown>;
  comment?: string | null;
  preferredOver?: string | null;
}): Promise<void> {
  // Compute avg of numeric rubric dimensions (clamped 0..1).
  const nums = Object.values(opts.ratings || {})
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  if (nums.length === 0) return;
  const max = Math.max(...nums);
  const norm = max > 1 ? nums.map((n) => n / 5) : nums; // 1..5 → 0..1
  const avgScore = Math.max(0, Math.min(1, norm.reduce((s, n) => s + n, 0) / norm.length));
  // Fetch the orchestration's last assistant message + metadata.
  let promptText = '';
  let responseText = '';
  let model = 'unknown';
  let jurisdiction = 'GLOBAL';
  let taskKind = 'general';
  try {
    const m = await dbq(
      `SELECT role, content, metadata
         FROM legal_chat_messages
        WHERE orchestration_id = $1
        ORDER BY created_at ASC`,
      [opts.orchestrationId],
    );
    for (const row of (m.rows || [])) {
      const meta = (row.metadata && typeof row.metadata === 'object') ? row.metadata : {};
      if (row.role === 'user') promptText = String(row.content || promptText);
      if (row.role === 'assistant') {
        responseText = String(row.content || responseText);
        const metaRec = meta as { model?: unknown };
        model = String(metaRec.model || model);
      }
    }
    if (opts.sessionId) {
      const s = await dbq(
        `SELECT jurisdictions, mode FROM legal_chat_sessions WHERE id = $1`,
        [opts.sessionId],
      );
      if (s.rows[0]) {
        const js = s.rows[0].jurisdictions;
        const arr = Array.isArray(js) ? js : (typeof js === 'string' ? JSON.parse(js) : []);
        if (arr[0]) jurisdiction = String(arr[0]).toUpperCase();
        taskKind = mapModeToTaskKind(String(s.rows[0].mode || ''));
      }
    }
  } catch (e) {
    logger.warn('grpo: fetch context failed', { error: (e as Error).message });
  }

  // 1. Postgres preference pair (durable record).
  try {
    await dbq(
      `INSERT INTO nv_grpo_preference_pairs
         (orchestration_id, sme_user_id, jurisdiction, task_kind, model, ratings, avg_score, enqueued_redis)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [
        opts.orchestrationId, opts.smeUserId, jurisdiction, taskKind, model,
        JSON.stringify(opts.ratings ?? {}), avgScore, false,
      ],
    );
  } catch (e) {
    logger.warn('grpo: preference pair insert failed', { error: (e as Error).message });
  }

  // 2. Redis training stream + EMA bump.
  const enqueued = await enqueueTrainingPair({
    feedbackId: opts.feedbackId,
    orchestrationId: opts.orchestrationId,
    smeUserId: opts.smeUserId,
    jurisdiction, taskKind, model,
    prompt: promptText, response: responseText,
    ratings: Object.fromEntries(Object.entries(opts.ratings ?? {}).map(([k, v]) => [k, String(v)])),
    comment: opts.comment ?? null,
    preferredOver: opts.preferredOver ?? null,
  });
  if (enqueued) {
    try {
      await dbq(
        `UPDATE nv_grpo_preference_pairs SET enqueued_redis = TRUE
           WHERE orchestration_id = $1 AND sme_user_id = $2`,
        [opts.orchestrationId, opts.smeUserId],
      );
    } catch { /* */ }
  }
  await bumpEma({ jurisdiction, taskKind, model, avgScore });

  // 3. Reinforce / forget the corresponding mem0 entries.
  await applyRubricToMem0({
    smeUserId: opts.smeUserId,
    jurisdiction,
    orchestrationId: opts.orchestrationId,
    avgScore,
  });

  // 4. High-quality SME rubrics → searchable RAG corpus (expandable per jurisdiction).
  if (responseText.trim().length >= 40) {
    void ingestApprovedChatToRag({
      feedbackId: opts.feedbackId,
      orchestrationId: opts.orchestrationId,
      jurisdiction,
      taskKind,
      prompt: promptText,
      response: responseText,
      avgScore,
      smeUserId: opts.smeUserId,
      ratings: opts.ratings,
    }).catch((err) =>
      logger.warn('approved-chat RAG ingest failed', { error: (err as Error).message }),
    );
  }
}

async function runJudgeCrosscheck(feedbackId: number, orchestrationId: string): Promise<void> {
  try {
    const judge = await import('../services/testing/jrx-llm-judge-service.js').catch(() => null);
    if (!judge) return;
    const svc: any = (judge as any).nvLlmJudgeService;
    if (!svc?.evaluate) return;
    const verdict = await svc.evaluate({ orchestrationId }).catch(() => null);
    if (!verdict) return;
    await dbq(
      `UPDATE sme_feedback SET judge_verdict = $1::jsonb WHERE id = $2`,
      [JSON.stringify(verdict), feedbackId],
    );
  } catch {
    // best-effort
  }
}

// ─────────────────────────── Catalog endpoints ──────────────────────────────

router.get('/agents', async (req: Request, res: Response) => {
  const j = String(req.query.jurisdiction || 'IN').toUpperCase();
  const map: Record<string, string> = {
    IN: 'Jurexio-Legal-registry-IN.json',
    UK: 'Jurexio-Legal-registry-UK.json',
    US: 'Jurexio-Legal-registry-US.json',
    EU: 'Jurexio-Legal-registry-EU.json',
    SG: 'Jurexio-Legal-registry-SG.json',
    GC: 'Jurexio-Legal-registry-GC.json',
    DEFAULT: 'Jurexio-Legal-registry-Default.json',
  };
  const fname = map[j] || map.DEFAULT;
  try {
    // Registries live at config/agent-registries/ (post-v5 staging consolidation)
    const fpath = path.join(process.cwd(), 'config', 'agent-registries', fname);
    const raw = fs.readFileSync(fpath, 'utf-8');
    const data = JSON.parse(raw);
    const meta = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    const list: any[] = Array.isArray(data) ? data
      : Array.isArray(data.agents) ? data.agents
      : Array.isArray(data.roster) ? data.roster
      : [];
    res.json({
      ok: true,
      jurisdiction: j,
      registryVersion: meta.registryVersion ?? '5.1.0',
      registryFormat: meta.registryFormat ?? null,
      totalAgents: meta.totalAgents ?? list.length,
      count: list.length,
      agents: list.map((a) => ({
        id: a.id,
        name: a.name,
        category: a.category,
        practiceArea: a.practiceArea,
        description: a.description,
        tier: a.tier,
      })).slice(0, 200),
    });
  } catch (err) {
    res.status(500).json({ error: 'agent registry read failed', detail: (err as Error).message });
  }
});

router.get('/models', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    count: MODEL_CATALOG.length,
    models: MODEL_CATALOG.map((m: any) => ({
      id: m.id,
      provider: m.provider,
      ctx: m.ctx,
      costInPer1M: m.costInPer1M,
      costOutPer1M: m.costOutPer1M,
      capabilities: m.capabilities,
      legalQuality: m.legalQuality,
    })),
  });
});

// ─────────────────────────── Replay ─────────────────────────────────────────

router.post('/replay/:orchestrationId', async (req: Request, res: Response) => {
  res.status(202).json({
    ok: true,
    note: 'replay queued — POST to /send with prior session + override prompt',
    orchestrationId: req.params.orchestrationId,
  });
});

// ─────────────────────────── SME allocations (Superadmin) ───────────────────

router.get('/sme-allocations', requireSuperadmin, async (_req: Request, res: Response) => {
  try {
    const r = await dbq(
      `SELECT a.id, a.sme_user_id, a.allocated_by_user_id, a.scope, a.active,
              a.created_at, a.revoked_at,
              COALESCE(u.email, u2.email, a.scope->>'email', a.scope->>'smeEmail') AS sme_email,
              COALESCE(u.full_name, u2.full_name, a.scope->>'name') AS sme_name
         FROM sme_allocations a
         LEFT JOIN nv_users u ON u.id = a.sme_user_id
         LEFT JOIN nv_users u2 ON LOWER(u2.email) = LOWER(COALESCE(a.scope->>'email', a.scope->>'smeEmail', ''))
                                AND COALESCE(a.scope->>'email', a.scope->>'smeEmail', '') <> ''
         ORDER BY a.created_at DESC LIMIT 200`,
    );
    res.json({ ok: true, allocations: r.rows });
  } catch (err) {
    res.status(500).json({ error: 'list allocations failed', detail: (err as Error).message });
  }
});

router.post('/sme-allocations', requireSuperadmin, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const allocator = parseInt(String(authReq.user!.id), 10);
  const { smeUserId, smeEmail, scope } = req.body || {};
  try {
    let resolvedSmeId: number | null = null;
    if (smeUserId) resolvedSmeId = parseInt(String(smeUserId), 10);
    else if (smeEmail) {
      const u = await dbq(`SELECT id FROM nv_users WHERE email = $1 LIMIT 1`, [smeEmail]);
      if (u.rows[0]) resolvedSmeId = u.rows[0].id;
    }
    if (!resolvedSmeId) { res.status(400).json({ error: 'smeUserId or smeEmail required' }); return; }
    const scopePayload = {
      ...(scope ?? {}),
      ...(smeEmail ? { email: smeEmail, smeEmail } : {}),
    };
    const r = await dbq(
      `INSERT INTO sme_allocations
         (sme_user_id, allocated_by_user_id, scope, active, created_at)
       VALUES ($1,$2,$3::jsonb,true,NOW())
       RETURNING id, sme_user_id, allocated_by_user_id, scope, active, created_at`,
      [resolvedSmeId, allocator, JSON.stringify(scopePayload)],
    );
    res.json({ ok: true, allocation: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'create allocation failed', detail: (err as Error).message });
  }
});

router.delete('/sme-allocations/:id', requireSuperadmin, async (req: Request, res: Response) => {
  try {
    await dbq(
      `UPDATE sme_allocations SET active = false, revoked_at = NOW() WHERE id = $1`,
      [parseInt(String(req.params.id ?? ""), 10)],
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'revoke failed', detail: (err as Error).message });
  }
});

// ─────────────────────────── helpers ────────────────────────────────────────

function mapModeToTaskKind(mode?: string): string {
  switch ((mode || '').toLowerCase()) {
    case 'drafting': return 'legal_drafting';
    case 'document-qa':
    case 'document_qa': return 'legal_research';
    case 'statute-lookup':
    case 'statute_lookup': return 'legal_research';
    case 'compliance-review':
    case 'compliance_review': return 'compliance_review';
    case 'litigation-strategy':
    case 'litigation_strategy': return 'chain_of_thought';
    default: return 'general';
  }
}

export default router;
