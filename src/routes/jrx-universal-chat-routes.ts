/**
 * Universal Chat backend routes (task-257, 2026-05-13)
 * ─────────────────────────────────────────────────────────────────────────────
 * Mounted at `/api/chat/*`. Powers the `/universal-chat` Console testbed page
 * (`client/src/pages/UniversalChat.tsx`).
 *
 * Replaces the stub handlers that previously lived in
 * `jrx-console-page-stubs-routes.ts` (the selector + sessions block) with a
 * real, LRM-routed chat backend so users get actual agent replies instead of
 * a placeholder string and an amber "stub mode" banner.
 *
 * Endpoints
 * ─────────
 *   GET    /chat/agent-groups         catalog of agent groups (no auth — selector data)
 *   GET    /chat/languages            catalog of supported languages
 *   POST   /chat/sessions             create an in-memory session, returns sessionId
 *   GET    /chat/sessions/:id         fetch session metadata + message history
 *   POST   /chat/sessions/:id/messages
 *                                     append a user message, run orchestrateLLM,
 *                                     return assistant reply + workflow steps
 *   POST   /chat/sessions/:id/upload  multipart upload, persisted to object storage
 *
 * Hard rules
 * ──────────
 *  - NV-LRM-001: assistant replies go through `orchestrateLLM` (single-router
 *    rule). No direct LLM calls.
 *  - NV-WIRING-001: mounted from `src/index.ts`.
 *  - NV-NAMING-001: file prefix `jrx-`, edits to existing stub file rather
 *    than introducing parallel chat infra.
 *  - Session storage is intentionally process-local (Map with TTL eviction).
 *    Universal Chat is a single-user testbed against the orchestrator; it is
 *    NOT the persistent legal-chat dashboard (that lives under
 *    `/api/jrx/legal-chat` and is DB-backed).
 */
import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createLogger } from '../utils/logger.js';
import { sendApiError, safeError } from '../utils/jrx-api-error.js';
import { JRX_AGENTS } from '../config/jrx-master-config.js';
import { orchestrateLLM } from '../services/intelligent-router/index.js';
import type { OrchestrationInput } from '../services/intelligent-router/index.js';
import { authenticateToken } from '../middleware/jrx-auth.js';
import { aiPatternRateLimit, authenticatedRateLimit } from '../middleware/jrx-rate-limit-middleware.js';
import { JrxDocumentStorageService } from '../services/jrx-document-storage-service.js';

const logger = createLogger('./jrx-universal-chat-routes');

// ── Selector catalogs ───────────────────────────────────────────────────────

interface AgentGroup {
  id: string;
  name: string;
  description: string;
  taskKind: NonNullable<OrchestrationInput['routing']['taskKind']>;
  systemPromptHint: string;
}

const AGENT_GROUPS: AgentGroup[] = [
  {
    id: 'auto',
    name: 'Auto-route (NS LRM decides)',
    description: 'Let the orchestrator pick the right specialist agent.',
    taskKind: 'generic_chat',
    systemPromptHint:
      'You are NS LRM, the Jurexio Legal Reasoning Model. Auto-route the query to the most appropriate domain (litigation, corporate, regulatory, research) and answer with an evidence-backed, citation-aware response.',
  },
  {
    id: 'litigation',
    name: 'Litigation specialists',
    description: 'Civil, criminal, writ and arbitration counsel.',
    taskKind: 'litigation_strategy',
    systemPromptHint:
      'You are a litigation specialist. Frame answers in terms of cause of action, forum, limitation, reliefs, and applicable procedural code. Cite leading judgments where directly on point.',
  },
  {
    id: 'corporate',
    name: 'Corporate & contracts',
    description: 'M&A, contracts, compliance, secretarial.',
    taskKind: 'contract_analysis',
    systemPromptHint:
      'You are a corporate and contracts specialist. Identify obligations, risks, conditions precedent, indemnities, governing law and dispute resolution. Where reviewing a contract, return a structured issues list.',
  },
  {
    id: 'regulatory',
    name: 'Regulatory & compliance',
    description: 'DPDPA, SEBI, RBI, EU AI Act, GDPR.',
    taskKind: 'compliance_review',
    systemPromptHint:
      'You are a regulatory & compliance specialist. Map the query to the controlling regulator (DPDPA Board, SEBI, RBI, EU AI Office, ICO, etc.), cite the operative provision, and call out reporting/notification timelines.',
  },
  {
    id: 'research',
    name: 'Research & drafting',
    description: 'Statute / case-law research and brief drafting.',
    taskKind: 'legal_research',
    systemPromptHint:
      'You are a legal research and drafting specialist. Provide a statute-and-case-law walkthrough first, then a clear drafting recommendation. Flag any conflicting authorities.',
  },
];

const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
];

const LANGUAGE_BY_CODE: Record<string, { code: string; name: string; native: string }> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l]),
);

// ── In-memory session store ─────────────────────────────────────────────────

interface ChatAttachmentMeta {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /**
   * Where the file bytes actually live:
   *   - 's3'            → AWS S3 / S3-compatible object storage at `storageKey`.
   *   - 'local-scratch' → on-disk scratch path at `storageKey` (used as a
   *     fallback when object storage is unavailable, so file bytes are
   *     never silently dropped).
   */
  storageBackend: 's3' | 'local-scratch';
  storageKey: string;
  uploadedAt: string;
}

const SCRATCH_DIR = path.join(os.tmpdir(), 'jrx-universal-chat');

interface ChatTurn {
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

interface ChatSessionRecord {
  sessionId: string;
  /**
   * Stable identifier of the user who created the session. All subsequent
   * GET/message/upload calls must come from the same user — closes the
   * session-level IDOR window where any authenticated caller who guessed
   * a sessionId could read or post to it.
   */
  ownerId: string;
  agentGroupId: string;
  language: string;
  createdAt: number;
  lastUsedAt: number;
  history: ChatTurn[];
  attachments: ChatAttachmentMeta[];
}

function ownerIdOf(req: Request): string {
  const u = (req as Request & { user?: { id?: string; userId?: string } }).user;
  return String(u?.id ?? u?.userId ?? 'anonymous');
}

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour idle eviction
const MAX_SESSIONS = 500;
const MAX_HISTORY_TURNS = 40;

const sessions = new Map<string, ChatSessionRecord>();

function gcSessions(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastUsedAt > SESSION_TTL_MS) sessions.delete(id);
  }
  if (sessions.size > MAX_SESSIONS) {
    // Drop oldest (Map iteration is insertion order).
    const overflow = sessions.size - MAX_SESSIONS;
    let i = 0;
    for (const id of sessions.keys()) {
      if (i++ >= overflow) break;
      sessions.delete(id);
    }
  }
}

function getSession(sessionId: string): ChatSessionRecord | null {
  const s = sessions.get(sessionId);
  if (!s) return null;
  if (Date.now() - s.lastUsedAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return null;
  }
  return s;
}

// ── Object storage adapter (lazy) ───────────────────────────────────────────

let _chatStorageService: JrxDocumentStorageService | null = null;

async function getChatStorage(): Promise<JrxDocumentStorageService | null> {
  if (_chatStorageService) return _chatStorageService;
  try {
    _chatStorageService = JrxDocumentStorageService.getInstance();
    return _chatStorageService;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn('document storage unavailable — universal-chat uploads will fall back to local scratch', { err: msg });
    return null;
  }
}

// ── Upload middleware ───────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
});

// ── Request bodies ──────────────────────────────────────────────────────────

interface ChatSessionRequestBody {
  agentGroupId?: string;
  language?: string;
}

interface ChatMessageRequestBody {
  content?: string;
  useWorkflow?: boolean;
}

// ── Workflow-mode synthesis ─────────────────────────────────────────────────
// "Workflow mode" in the Console UI displays a side-panel of step cards.
// We synthesize a small, deterministic, post-hoc workflow trace from the
// orchestrator result (not a separate plan-execute pipeline) so the UI
// renders meaningful progress without us pretending to run agents we did
// not actually run.

function buildWorkflowSteps(
  group: AgentGroup,
  orchestratorModel: string,
  orchestratorProvider: string,
): Array<{ stepId: string; stepNumber: number; title: string; description: string; status: 'completed'; agentName: string }> {
  return [
    {
      stepId: randomUUID(),
      stepNumber: 1,
      title: 'Classify request',
      description: `Routed to "${group.name}" (taskKind=${group.taskKind}).`,
      status: 'completed',
      agentName: 'NS LRM Router',
    },
    {
      stepId: randomUUID(),
      stepNumber: 2,
      title: 'Select model',
      description: `Picked ${orchestratorModel} via ${orchestratorProvider}.`,
      status: 'completed',
      agentName: 'Intelligent Router',
    },
    {
      stepId: randomUUID(),
      stepNumber: 3,
      title: 'Generate response',
      description: 'Composed answer with jurisdiction-aware system prompt.',
      status: 'completed',
      agentName: group.name,
    },
  ];
}

// ── Router ──────────────────────────────────────────────────────────────────

export function createUniversalChatRouter(): Router {
  const router = Router();

  // Selectors stay public — they're catalog data with no LLM cost. Everything
  // that creates a session, sends a message, or uploads bytes is gated behind
  // `authenticateToken` (Console JWT or inter-service / SDK API key) AND a
  // rate limit so an unauthenticated client cannot drive real `orchestrateLLM`
  // calls or scratch-disk writes.

  router.get('/chat/agent-groups', (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: AGENT_GROUPS.map(({ id, name, description }) => ({ id, name, description })),
      meta: { totalAgents: JRX_AGENTS.totalAgents },
    });
  });

  router.get('/chat/languages', (_req: Request, res: Response) => {
    res.json({ success: true, data: LANGUAGES });
  });

  router.post('/chat/sessions', authenticateToken, authenticatedRateLimit, (req: Request<unknown, unknown, ChatSessionRequestBody>, res: Response) => {
    gcSessions();
    const agentGroupId = String(req.body?.agentGroupId ?? 'auto');
    const language = String(req.body?.language ?? 'en');
    const group = AGENT_GROUPS.find((g) => g.id === agentGroupId) ?? AGENT_GROUPS[0]!;
    const lang = LANGUAGE_BY_CODE[language] ?? LANGUAGE_BY_CODE['en']!;
    const sessionId = `chat-${randomUUID()}`;
    const now = Date.now();
    const record: ChatSessionRecord = {
      sessionId,
      ownerId: ownerIdOf(req as Request),
      agentGroupId: group.id,
      language: lang.code,
      createdAt: now,
      lastUsedAt: now,
      history: [],
      attachments: [],
    };
    sessions.set(sessionId, record);
    res.json({
      success: true,
      data: {
        sessionId,
        agentGroupId: group.id,
        language: lang.code,
        createdAt: new Date(now).toISOString(),
      },
    });
  });

  router.get('/chat/sessions/:sessionId', authenticateToken, authenticatedRateLimit, (req: Request<{ sessionId: string }>, res: Response) => {
    const session = getSession(req.params.sessionId);
    if (!session) {
      return sendApiError(res, 'NOT_FOUND');
    }
    if (session.ownerId !== ownerIdOf(req)) {
      return sendApiError(res, 'BAD_REQUEST', { status: 403, overrideMessage: 'session not owned by caller' });
    }
    return res.json({
      success: true,
      data: {
        sessionId: session.sessionId,
        agentGroupId: session.agentGroupId,
        language: session.language,
        createdAt: new Date(session.createdAt).toISOString(),
        lastUsedAt: new Date(session.lastUsedAt).toISOString(),
        messages: session.history,
        attachments: session.attachments,
      },
    });
  });

  router.post(
    '/chat/sessions/:sessionId/messages',
    authenticateToken,
    aiPatternRateLimit,
    async (
      req: Request<{ sessionId: string }, unknown, ChatMessageRequestBody>,
      res: Response,
    ) => {
      const session = getSession(req.params.sessionId);
      if (!session) {
        return sendApiError(res, 'NOT_FOUND');
      }
      if (session.ownerId !== ownerIdOf(req)) {
        return sendApiError(res, 'BAD_REQUEST', { status: 403, overrideMessage: 'session not owned by caller' });
      }
      const content = String(req.body?.content ?? '').trim();
      if (!content) {
        return sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'content is required' });
      }
      const useWorkflow = !!req.body?.useWorkflow;
      const group =
        AGENT_GROUPS.find((g) => g.id === session.agentGroupId) ?? AGENT_GROUPS[0]!;
      const langName = LANGUAGE_BY_CODE[session.language]?.name ?? 'English';

      const now = new Date().toISOString();
      const userMessage: ChatTurn = {
        messageId: `msg-${randomUUID()}`,
        role: 'user',
        content,
        metadata: { attachments: session.attachments.map((a) => a.attachmentId) },
        timestamp: now,
      };
      session.history.push(userMessage);

      // Build the running message thread for the orchestrator. Cap to last
      // MAX_HISTORY_TURNS so the prompt does not grow unbounded.
      const threadForOrchestrator = session.history
        .slice(-MAX_HISTORY_TURNS)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const attachmentSummary =
        session.attachments.length > 0
          ? `\n\nUser-attached files (metadata only, contents not inlined): ${session.attachments
              .map((a) => `${a.filename} (${a.mimeType}, ${a.sizeBytes} bytes)`)
              .join('; ')}.`
          : '';

      const systemPrompt =
        `${group.systemPromptHint}\n` +
        `Respond in ${langName}.` +
        (useWorkflow
          ? '\nThe user enabled Workflow Mode — structure the answer as numbered steps so the side-panel timeline reads naturally.'
          : '') +
        attachmentSummary;

      const requestId = `uchat-${randomUUID()}`;
      try {
        const orch = await orchestrateLLM({
          requestId,
          systemPrompt,
          userMessage: content,
          messages: threadForOrchestrator,
          maxTokens: useWorkflow ? 3000 : 2000,
          temperature: 0.3,
          routing: {
            agentId: `universal-chat:${group.id}`,
            agentClass: 'specialist',
            taskKind: group.taskKind,
            tier: 'enterprise',
            jurisdiction: 'IN',
            promptTokens: Math.ceil((systemPrompt.length + content.length) / 4),
            patternKey: 'P01',
            app: 'universal-chat',
          },
        });

        const assistantMessage: ChatTurn = {
          messageId: `msg-${randomUUID()}`,
          role: 'assistant',
          content: orch.content,
          metadata: {
            agentId: `universal-chat:${group.id}`,
            agentName: group.name,
            modelUsed: orch.model,
            provider: orch.provider,
            tokensUsed: orch.tokensIn + orch.tokensOut,
            processingTime: orch.latencyMs,
            fallbackLevel: orch.fallbackLevel,
            isSimulation: orch.isSimulation,
            requestId: orch.requestId,
          },
          timestamp: new Date().toISOString(),
        };
        session.history.push(assistantMessage);
        session.lastUsedAt = Date.now();

        const workflowSteps = useWorkflow
          ? buildWorkflowSteps(group, orch.model, orch.provider)
          : undefined;

        return res.json({
          success: true,
          data: {
            userMessage,
            assistantMessage,
            workflowSteps,
          },
        });
      } catch (err) {
        // orchestrateLLM is contractually non-throwing; this branch is a
        // hard infra fault (NV-OWNERSHIP-001 — surface, do not swallow).
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('universal-chat orchestrator threw', {
          requestId,
          sessionId: session.sessionId,
          err: msg,
        });
        return sendApiError(res, 'INTERNAL_ERROR', {
          status: 502,
          overrideMessage: 'orchestrator unavailable',
          details: { message: msg, requestId },
        });
      }
    },
  );

  router.post(
    '/chat/sessions/:sessionId/upload',
    authenticateToken,
    authenticatedRateLimit,
    upload.array('files', 10),
    async (req: Request<{ sessionId: string }>, res: Response) => {
      const session = getSession(req.params.sessionId);
      if (!session) {
        return sendApiError(res, 'NOT_FOUND');
      }
      if (session.ownerId !== ownerIdOf(req)) {
        return sendApiError(res, 'BAD_REQUEST', { status: 403, overrideMessage: 'session not owned by caller' });
      }
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) {
        return sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'no files uploaded' });
      }

      const storage = await getChatStorage();
      const accepted: ChatAttachmentMeta[] = [];

      for (const f of files) {
        const attachmentId = randomUUID();
        const safeName = path.basename(f.originalname).replace(/[^A-Za-z0-9._-]/g, '_');
        const objectKey = `universal-chat/${session.sessionId}/${attachmentId}/${safeName}`;

        let backend: ChatAttachmentMeta['storageBackend'] | null = null;
        let storageKey = objectKey;

        if (storage) {
          try {
            await storage.uploadRaw(objectKey, f.buffer, f.mimetype || 'application/octet-stream');
            backend = 's3';
          } catch (err) {
            logger.warn('document storage upload failed — falling back to local scratch', {
              sessionId: session.sessionId,
              storageKey: objectKey,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }

        if (backend === null) {
          // Persist bytes to a per-session scratch dir under os.tmpdir() so
          // the upload is durable across the request lifecycle even when
          // object storage is unavailable. A different pod cannot fetch
          // these (that's documented at the top of the file), but on the
          // accepting pod the bytes are real, on-disk and survive the
          // session TTL.
          const dir = path.join(SCRATCH_DIR, session.sessionId, attachmentId);
          await fs.promises.mkdir(dir, { recursive: true });
          const scratchPath = path.join(dir, safeName);
          await fs.promises.writeFile(scratchPath, f.buffer);
          backend = 'local-scratch';
          storageKey = scratchPath;
        }

        const meta: ChatAttachmentMeta = {
          attachmentId,
          filename: safeName,
          mimeType: f.mimetype || 'application/octet-stream',
          sizeBytes: f.size,
          storageBackend: backend,
          storageKey,
          uploadedAt: new Date().toISOString(),
        };
        session.attachments.push(meta);
        accepted.push(meta);
      }
      session.lastUsedAt = Date.now();

      return res.json({
        success: true,
        data: {
          accepted: accepted.length,
          attachments: accepted,
        },
      });
    },
  );

  return router;
}
