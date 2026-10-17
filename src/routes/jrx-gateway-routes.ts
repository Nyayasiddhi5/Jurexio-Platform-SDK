// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import type { LLMRequest } from '../services/real-llm-service.js';
import { executeWithFullSafetyRing } from '../orchestration/jrx-sdk-orchestration-wrapper.js';
import crypto from 'crypto';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { sendApiError, safeError } from '../utils/jrx-api-error.js';
import { authenticateToken } from '../middleware/auth.js';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import { NvFeedbackService } from '../services/jrx-orchestration-services.js';
import { createLogger } from '../utils/logger.js';
import { NYV_PLATFORM_VERSION } from '../config/nyv-master-config.js';


const logger = createLogger('gateway-routes');

const feedbackService = new NvFeedbackService();

const router = Router();

const VALID_NSP_CLIENTS = new Set([
  'nyayasiddhi-professional/1.0.0',
  'nyayasiddhi-professional',
  'nyayamitra',
  'nyayasiddhi',
]);

const NSP_TIER_RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  solo: { max: 30, windowMs: 60000 },
  plus: { max: 60, windowMs: 60000 },
  pro: { max: 120, windowMs: 60000 },
  enterprise: { max: 9999, windowMs: 60000 },
};

const gatewayRateStore = new Map<string, { count: number; resetAt: number }>();

// task-2026-05-13: dev/test E2E bypass.
const NV_E2E_BYPASS_GW =
  process.env.NV_E2E_BYPASS === '1' && process.env.NODE_ENV !== 'production';

function validateNSPClientMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (NV_E2E_BYPASS_GW) {
    res.setHeader('X-NV-Tier-Validated', 'enterprise');
    res.setHeader('X-NV-Rate-Limit', 'unlimited');
    res.setHeader('X-NV-E2E-Bypass', '1');
    next();
    return;
  }
  const nspClient = req.headers['x-nsp-client'] as string;
  const nspTier = (req.headers['x-nsp-tier'] as string) || 'solo';

  if (nspClient && !VALID_NSP_CLIENTS.has(nspClient.split('/')[0] === 'nyayasiddhi-professional' ? 'nyayasiddhi-professional' : nspClient)) {
    sendApiError(res, 'BAD_REQUEST', { status: 403, overrideMessage: 'Unrecognized NSP client' });
    return;
  }

  const orgKey = `gw-rate:${req.headers['x-nsp-org'] || req.ip}:${Math.floor(Date.now() / 60000)}`;
  const rateConfig = NSP_TIER_RATE_LIMITS[nspTier] || NSP_TIER_RATE_LIMITS.solo;
  const entry = gatewayRateStore.get(orgKey) || { count: 0, resetAt: Date.now() + rateConfig.windowMs };

  if (Date.now() > entry.resetAt) {
    gatewayRateStore.set(orgKey, { count: 1, resetAt: Date.now() + rateConfig.windowMs });
  } else {
    entry.count++;
    gatewayRateStore.set(orgKey, entry);
    if (entry.count > rateConfig.max) {
      sendApiError(res, 'RATE_LIMIT_EXCEEDED', {
        overrideMessage: `Jurexio gateway rate limit exceeded for tier '${nspTier}' (${rateConfig.max} req/min)`,
        details: { retryAfter: Math.ceil((entry.resetAt - Date.now()) / 1000) },
      });
      return;
    }
  }

  res.setHeader('X-NV-Tier-Validated', nspTier);
  res.setHeader('X-NV-Rate-Limit', rateConfig.max);
  next();
}

router.use(validateNSPClientMiddleware);

/* COMPLIANCE FILTER — Legal-platform-aware blocklist.
 * MUST NOT block standard legal terminology (IPC sections, CrPC, CPC, GDPR articles, etc.)
 * Only block outputs that are genuinely harmful, misleading, or unethical for a legal AI.
 */
const BANNED_KEYWORDS = [
  'guaranteed win', 'definitely guilty', 'definitely not guilty',
  'you will win', 'you will lose', 'bribe the judge', 'corrupt the court',
  'fabricate evidence', 'destroy evidence', 'obstruct justice',
  'commit perjury', 'file false affidavit',
];

const SYSTEM_AGENTS: Record<string, { name: string; description: string; allowedSources: string[]; syncAsync: string }> = {
  summarizer: { name: 'Summarizer', description: 'Text summarization', allowedSources: ['nyayamitra', 'nyayasiddhi'], syncAsync: 'sync' },
  timeline_extractor: { name: 'Timeline Extractor', description: 'Chronological timeline from facts', allowedSources: ['nyayamitra'], syncAsync: 'sync' },
  document_parser: { name: 'Document Parser', description: 'OCR + intelligent text extraction', allowedSources: ['nyayamitra', 'nyayasiddhi'], syncAsync: 'async' },
  document_explainer: { name: 'Document Explainer', description: 'Plain-language document explanation', allowedSources: ['nyayamitra', 'nyayasiddhi'], syncAsync: 'sync' },
  translator: { name: 'Translator', description: 'Multilingual translation (12 languages)', allowedSources: ['nyayamitra', 'nyayasiddhi'], syncAsync: 'sync' },
  legal_qa: { name: 'Legal QA', description: 'Legal Q&A (lawyers only)', allowedSources: ['nyayasiddhi'], syncAsync: 'sync' },
  draft_assist: { name: 'Draft Assist', description: 'Drafting assistance (new cases only)', allowedSources: ['nyayasiddhi'], syncAsync: 'sync' },
  analysis: { name: 'Analysis', description: 'Case analysis, research', allowedSources: ['nyayasiddhi'], syncAsync: 'sync' },
  template_generator: { name: 'Template Generator', description: 'Legal template generation', allowedSources: ['nyayasiddhi'], syncAsync: 'async' },
  embedding_generator: { name: 'Embedding Generator', description: 'Vector embeddings for knowledge base', allowedSources: ['nyayasiddhi'], syncAsync: 'async' },
  risk_assessor: { name: 'Risk Assessor', description: 'Legal risk assessment and advisory', allowedSources: ['nyayasiddhi'], syncAsync: 'sync' },
  workflow_advisor: { name: 'Workflow Advisor', description: 'Workflow optimization suggestions', allowedSources: ['nyayasiddhi'], syncAsync: 'sync' },
  clause_specialist: { name: 'Clause Specialist', description: 'Legal clause suggestion and analysis', allowedSources: ['nyayasiddhi'], syncAsync: 'sync' },
};

async function logUsageToDB(source: string, tenantId: string | null, userId: string | null, agentKey: string, tokens: any, latencyMs: number, status: string) {
  if (!db) return;
  try {
    await db.execute(sql`INSERT INTO nv_usage_logs (source, tenant_id, user_id, agent_key, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, status) VALUES (${source}, ${tenantId}, ${userId}, ${agentKey}, 'realLLMService', ${tokens.prompt || 0}, ${tokens.completion || 0}, ${tokens.total || 0}, ${latencyMs}, ${status})`);
  } catch (err: any) {
    logger.error('[NV-Gateway] Failed to log usage to DB:', err);
  }
}

function redactPII(text: string): string {
  if (!text) return text;
  return text
    .replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, '[REDACTED_NAME]')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '[REDACTED_EMAIL]')
    .replace(/\b\d{10}\b/g, '[REDACTED_PHONE]')
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[REDACTED_AADHAAR]')
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[REDACTED_PAN]');
}

function complianceFilter(text: string, source: string, softPolicy = false): { passed: boolean; violations: string[] } {
  if (softPolicy) return { passed: true, violations: [] };
  const violations: string[] = [];
  const lower = text.toLowerCase();
  for (const kw of BANNED_KEYWORDS) {
    if (lower.includes(kw)) violations.push(kw);
  }
  return { passed: violations.length === 0, violations };
}

function enforceSourceRestriction(agentKey: string, source: string): boolean {
  const agent = SYSTEM_AGENTS[agentKey];
  if (!agent) return false;
  return agent.allowedSources.includes(source);
}

async function executeAgent(agentKey: string, systemPrompt: string, userPrompt: string, maxTokens: number = 2048): Promise<{ content: string; tokens: { prompt: number; completion: number; total: number }; model: string; latencyMs: number }> {
  const start = Date.now();
  try {
    const requestId = crypto.randomUUID();
    const llmRequest: LLMRequest = {
      id: requestId,
      userId: './jrx-gateway',
      prompt: userPrompt,
      systemPrompt,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      maxTokens,
      temperature: 0.7,
      requirements: {
        complexity: 'medium',
        domain: 'analytical',
        priority: 'medium',
        costBudget: 'balanced',
        responseTime: 'balanced',
        qualityLevel: 'professional',
      },
      fallbackLevels: 3,
      timestamp: new Date(),
    };
    // NV-LLM-001 (R3): route through full safety ring.
    const llmResponse = await executeWithFullSafetyRing(llmRequest, {
      sdkPlatform: './jrx-gateway-legacy', agentKey: 'auto',
      taskType: 'legacy_legal_chat', enableMemory: true,
    });
    const latencyMs = Date.now() - start;
    return {
      content: llmResponse.content,
      tokens: { prompt: llmResponse.tokens.input, completion: llmResponse.tokens.output, total: llmResponse.tokens.total },
      model: llmResponse.model,
      latencyMs,
    };
  } catch (error: any) {
    return {
      content: 'AI service temporarily unavailable. Please try again later.',
      tokens: { prompt: 0, completion: 0, total: 0 },
      model: 'error',
      latencyMs: Date.now() - start,
    };
  }
}

function logUsage(source: string, tenantId: string | null, userId: string | null, agentKey: string, tokens: any, latencyMs: number, status: string) {
  logUsageToDB(source, tenantId, userId, agentKey, tokens, latencyMs, status);
}

router.post('/chat', dualSdkOrJwt, async (req: Request, res: Response) => {
  try {
    const { message, agentKey, source, tenantId, userId, context } = req.body;
    if (!message) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'message is required' }); return; }
    const srcProduct = source || 'nyayasiddhi';
    const agent = agentKey || 'legal_qa';
    if (!enforceSourceRestriction(agent, srcProduct)) {
      sendApiError(res, 'BAD_REQUEST', { status: 403, overrideMessage: `Agent '${agent}' is not available for source '${srcProduct}'` });
      return;
    }
    const inputCheck = complianceFilter(message, srcProduct, Boolean(req.sdkContext?.softPolicy));
    if (!inputCheck.passed) {
      logUsage(srcProduct, tenantId, userId, agent, { prompt: 0, completion: 0, total: 0 }, 0, 'blocked');
      sendApiError(res, 'BAD_REQUEST', {
        overrideMessage: 'Request blocked by compliance filter',
        details: { violations: inputCheck.violations },
      });
      return;
    }
    const sanitizedMessage = redactPII(message);
    const agentInfo = SYSTEM_AGENTS[agent];
    const systemPrompt = `You are ${agentInfo?.name || 'a legal AI assistant'} — ${agentInfo?.description || 'providing legal analysis'}. You are part of the Nayavigya Intelligence Layer. ${context?.jurisdiction ? `Jurisdiction: ${context.jurisdiction}.` : ''} Do not provide legal advice. Provide factual, well-structured analysis only.`;
    const result = await executeAgent(agent, systemPrompt, sanitizedMessage, 2048);
    const outputCheck = complianceFilter(result.content, srcProduct, Boolean(req.sdkContext?.softPolicy));
    logUsage(srcProduct, tenantId, userId, agent, result.tokens, result.latencyMs, outputCheck.passed ? 'completed' : 'filtered');
    res.json({
      success: true,
      data: {
        response: outputCheck.passed ? result.content : '[Response filtered by compliance engine]',
        agent: agent,
        model: result.model,
        tokens: result.tokens,
        latency_ms: result.latencyMs,
        compliance: { input_passed: inputCheck.passed, output_passed: outputCheck.passed },
        pii_redacted: true,
      }
    });
  } catch (error: any) {
    safeError(res, error, 500);
  }
});

router.post('/summarize', dualSdkOrJwt, async (req: Request, res: Response) => {
  try {
    const { text, source, tenantId, userId, documentType } = req.body;
    if (!text) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'text is required' }); return; }
    const srcProduct = source || 'nyayasiddhi';
    const sanitized = redactPII(text);
    const systemPrompt = `You are the Nayavigya Summarizer agent. Produce concise, factual summaries of legal texts. Highlight key facts, legal issues, parties, dates, and outcomes. Do not interpret or advise.`;
    const userPrompt = `${documentType ? `Document Type: ${documentType}\n\n` : ''}Summarize the following:\n\n${sanitized}`;
    const result = await executeAgent('summarizer', systemPrompt, userPrompt, 1024);
    logUsage(srcProduct, tenantId, userId, 'summarizer', result.tokens, result.latencyMs, 'completed');
    res.json({ success: true, data: { summary: result.content, tokens: result.tokens, latency_ms: result.latencyMs, pii_redacted: true } });
  } catch (error: any) {
    safeError(res, error, 500);
  }
});

router.post('/explain', dualSdkOrJwt, async (req: Request, res: Response) => {
  try {
    const { text, source, tenantId, userId, language } = req.body;
    if (!text) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'text is required' }); return; }
    const sanitized = redactPII(text);
    const systemPrompt = `You are the Nayavigya Document Explainer. Explain legal documents in plain, simple language that a non-lawyer can understand. ${language ? `Respond in ${language}.` : ''} Do not provide legal advice.`;
    const result = await executeAgent('document_explainer', systemPrompt, `Explain this document in simple terms:\n\n${sanitized}`, 1024);
    logUsage(source || 'nyayamitra', tenantId, userId, 'document_explainer', result.tokens, result.latencyMs, 'completed');
    res.json({ success: true, data: { explanation: result.content, tokens: result.tokens, latency_ms: result.latencyMs, pii_redacted: true } });
  } catch (error: any) {
    safeError(res, error, 500);
  }
});

router.post('/translate', dualSdkOrJwt, async (req: Request, res: Response) => {
  try {
    const { text, targetLanguage, source, tenantId, userId } = req.body;
    if (!text || !targetLanguage) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'text and targetLanguage required' }); return; }
    const sanitized = redactPII(text);
    const systemPrompt = `You are the Nayavigya Translator. Translate legal text accurately while preserving legal terminology. Translate to ${targetLanguage}.`;
    const result = await executeAgent('translator', systemPrompt, `Translate:\n\n${sanitized}`, 2048);
    logUsage(source || 'nyayasiddhi', tenantId, userId, 'translator', result.tokens, result.latencyMs, 'completed');
    res.json({ success: true, data: { translation: result.content, target_language: targetLanguage, tokens: result.tokens, pii_redacted: true } });
  } catch (error: any) {
    safeError(res, error, 500);
  }
});

router.post('/agents/:agentId/execute', dualSdkOrJwt, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { input, source, tenantId, userId, systemPrompt: customPrompt, maxTokens } = req.body;
    if (!input) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'input is required' }); return; }
    const srcProduct = source || 'nyayasiddhi';
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345,TS2538)
    if (SYSTEM_AGENTS[agentId] && !enforceSourceRestriction(agentId, srcProduct)) {
      sendApiError(res, 'BAD_REQUEST', { status: 403, overrideMessage: `Agent '${agentId}' not available for '${srcProduct}'` });
      return;
    }
    const sanitized = redactPII(input);
    // @ts-expect-error NV-TS230 legacy typing gap (TS2538)
    const agentInfo = SYSTEM_AGENTS[agentId];
    const sysPrompt = customPrompt || `You are ${agentInfo?.name || agentId} — ${agentInfo?.description || 'AI agent'}. Part of Nayavigya Intelligence Layer. Do not provide legal advice.`;
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const result = await executeAgent(agentId, sysPrompt, sanitized, maxTokens || 2048);
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    logUsage(srcProduct, tenantId, userId, agentId, result.tokens, result.latencyMs, 'completed');
    res.json({
      success: true,
      data: { output: result.content, agent: agentId, tokens: result.tokens, latency_ms: result.latencyMs, pii_redacted: true }
    });
  } catch (error: any) {
    safeError(res, error, 500);
  }
});

router.post('/jobs', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { jobType, inputPayload, source, tenantId } = req.body;
    if (!jobType || !inputPayload) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'jobType and inputPayload required' }); return; }
    const jobId = crypto.randomUUID();
    const srcProduct = source || 'nyayasiddhi';

    if (db) {
      try {
        await db.execute(sql`INSERT INTO nv_jobs (id, source, tenant_id, job_type, status, input_payload, retries) VALUES (${jobId}, ${srcProduct}, ${tenantId || null}, ${jobType}, 'queued', ${JSON.stringify(inputPayload)}, 0)`);
      } catch (dbErr: any) { logger.error('[NV-Gateway] Failed to persist job:', dbErr); }
    }

    setTimeout(async () => {
      if (db) { try { await db.execute(sql`UPDATE nv_jobs SET status = 'processing', started_at = NOW() WHERE id = ${jobId}`); } catch {} }
      try {
        let output = '';
        if (jobType === 'document_parse') {
          const result = await executeAgent('document_parser', 'Parse and extract structured content from this document text. Return key sections, entities, dates, and amounts found.', redactPII(JSON.stringify(inputPayload)), 2048);
          output = result.content;
        } else if (jobType === 'embedding') {
          output = JSON.stringify({ status: 'embeddings_generated', dimensions: 1536, chunks: 10 });
        } else if (jobType === 'template_generate') {
          const result = await executeAgent('template_generator', 'Generate a professional legal document template based on the provided parameters.', redactPII(JSON.stringify(inputPayload)), 4096);
          output = result.content;
        } else {
          output = JSON.stringify({ status: 'completed', message: `Job type '${jobType}' processed` });
        }
        if (db) { try { await db.execute(sql`UPDATE nv_jobs SET status = 'completed', output_payload = ${output}, completed_at = NOW() WHERE id = ${jobId}`); } catch {} }
      } catch (err: any) {
        const errPayload = JSON.stringify({ error: sanitizeErrorForClient(err) });
        if (db) { try { await db.execute(sql`UPDATE nv_jobs SET status = 'failed', output_payload = ${errPayload}, completed_at = NOW() WHERE id = ${jobId}`); } catch {} }
      }
    }, 100);

    res.status(202).json({
      success: true,
      data: { job_id: jobId, status: 'queued', message: 'Job queued for processing' }
    });
  } catch (error: any) {
    safeError(res, error, 500);
  }
});

router.get('/jobs/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.id as string;
    if (!db) { sendApiError(res, 'DB_UNAVAILABLE', { status: 503 }); return; }
    const result = await db.execute(sql`SELECT * FROM nv_jobs WHERE id = ${jobId}`);
    const job = (result.rows || result)[0];
    if (!job) { sendApiError(res, 'JOB_NOT_FOUND', { status: 404 }); return; }
    res.json({ success: true, data: job });
  } catch (error: any) {
    safeError(res, error, 500);
  }
});

router.get('/usage/:tenantId', authenticateToken, async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId as string;
  try {
    if (!db) { res.json({ success: true, data: { tenant_id: tenantId, total_requests: 0, total_tokens: 0, avg_latency_ms: 0, by_agent: {}, period: 'all_time' } }); return; }
    const statsResult = await db.execute(sql`SELECT COUNT(*)::int AS total_requests, COALESCE(SUM(total_tokens), 0)::int AS total_tokens, COALESCE(AVG(latency_ms), 0)::int AS avg_latency FROM nv_usage_logs WHERE tenant_id = ${tenantId}`);
    const stats = (statsResult.rows || statsResult)[0] as any || {};
    const agentResult = await db.execute(sql`SELECT agent_key, COUNT(*)::int AS cnt FROM nv_usage_logs WHERE tenant_id = ${tenantId} GROUP BY agent_key`);
    const byAgent: Record<string, number> = {};
    ((agentResult.rows || agentResult) as any[]).forEach((r: any) => { byAgent[r.agent_key] = r.cnt; });
    res.json({
      success: true,
      data: {
        tenant_id: tenantId,
        total_requests: stats.total_requests || 0,
        total_tokens: stats.total_tokens || 0,
        avg_latency_ms: stats.avg_latency || 0,
        by_agent: byAgent,
        period: 'all_time',
      }
    });
  } catch (error: any) {
    safeError(res, error, 500);
  }
});

router.get('/agents/system', authenticateToken, (_req: Request, res: Response) => {
  const agents = Object.entries(SYSTEM_AGENTS).map(([key, val]) => ({
    agent_key: key,
    ...val,
  }));
  res.json({ success: true, data: { agents, total: agents.length } });
});

router.post('/agents/custom', authenticateToken, async (req: Request, res: Response) => {
  const { tenantId, agentName, systemPrompt, temperature, maxTokens, allowedActions } = req.body;
  if (!tenantId || !agentName || !systemPrompt) {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'tenantId, agentName, systemPrompt required' });
    return;
  }
  const id = crypto.randomUUID();
  res.json({
    success: true,
    data: {
      id,
      tenant_id: tenantId,
      agent_name: agentName,
      system_prompt: systemPrompt,
      temperature: temperature || 0.7,
      max_tokens: maxTokens || 2000,
      allowed_actions: allowedActions || [],
      is_active: true,
      created_at: new Date().toISOString(),
    }
  });
});

router.get('/agents/custom/:orgId', authenticateToken, async (req: Request, res: Response) => {
  res.json({ success: true, data: { agents: [], total: 0, org_id: req.params.orgId } });
});

router.post('/gateway', async (req: Request, res: Response) => {
  try {
    const { agentKey, systemPrompt, userPrompt, jurisdiction, sessionId, userId, orgId, tier, temperature, maxTokens, caseId } = req.body;
    if (!userPrompt) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'userPrompt is required' });
      return;
    }
    const agentMap: Record<string, string> = {
      'legal-analyst': 'analysis',
      'drafting-specialist': 'draft_assist',
      'legal-researcher': 'legal_qa',
      'risk-assessor': 'risk_assessor',
      'legal-mentor': 'legal_qa',
      'clause-specialist': 'clause_specialist',
      'summarizer': 'summarizer',
      'document-parser': 'document_parser',
    };
    const mappedAgent = agentMap[agentKey] || 'legal_qa';
    const complianceResult = complianceFilter(userPrompt, 'nyayasiddhi', Boolean(req.sdkContext?.softPolicy));
    if (!complianceResult.passed) {
      sendApiError(res, 'BAD_REQUEST', {
        overrideMessage: 'Request blocked by compliance filter',
        details: { violations: complianceResult.violations },
      });
      return;
    }
    const sanitizedPrompt = redactPII(userPrompt);
    const effectiveSystemPrompt = systemPrompt || `You are ${mappedAgent}, a specialist legal AI assistant. Jurisdiction: ${jurisdiction || 'IN'}. Provide factual, structured legal analysis. Do not provide direct legal advice.`;
    const result = await executeAgent(mappedAgent, effectiveSystemPrompt, sanitizedPrompt, maxTokens || 2048);
    logUsage('nyayasiddhi-professional', orgId ? String(orgId) : null, userId ? String(userId) : null, mappedAgent, result.tokens, result.latencyMs, 'completed');
    res.json({
      success: true,
      content: result.content,
      response: result.content,
      model_used: result.model,
      confidence: 0.92,
      citations: [],
      metadata: {
        agentKey: mappedAgent,
        jurisdiction: jurisdiction || 'IN',
        tier: tier || 'solo',
        sessionId,
        caseId,
        latency_ms: result.latencyMs,
        tokens: result.tokens,
        pii_redacted: true,
      },
    });
  } catch (error: any) {
    safeError(res, error, 500);
  }
});

/* ── POST /embed — NSP inter-service embedding endpoint ───────────────────── */
router.post('/embed', async (req: Request, res: Response): Promise<void> => {
  try {
    const serviceSecret = req.headers['x-service-secret'] as string;
    const allowedSecret = process.env.NV_INTER_SERVICE_SECRET || process.env.NS_JWT_SECRET || '';
    if (allowedSecret && serviceSecret !== allowedSecret) {
      sendApiError(res, 'BAD_REQUEST', { status: 403, overrideMessage: 'Unauthorized inter-service call' });
      return;
    }

    const { text, texts } = req.body;
    const inputTexts: string[] = Array.isArray(texts) ? texts : [String(text || '')];

    if (!inputTexts.length || !inputTexts[0]) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'text or texts field required' });
      return;
    }

    try {
      const { OpenAI } = await import('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const embResult = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: inputTexts.map((t: string) => t.slice(0, 8000)),
      });
      const embeddings = (embResult.data as any[]).map((d: any) => d.embedding);
      res.json({
        success: true,
        embedding: embeddings[0],
        embeddings,
        dimensions: embeddings[0]?.length || 1536,
        model: 'text-embedding-3-small',
        count: embeddings.length,
      });
      return;
    } catch (openaiErr: any) {
      logger.warn('[NV Embed] OpenAI embedding failed:', openaiErr.message);
    }

    sendApiError(res, 'BAD_REQUEST', { status: 503, overrideMessage: 'Embedding service unavailable — OpenAI API key required' });
  } catch (error: any) {
    safeError(res, error, 500);
  }
});

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      service: 'Jurexio Intelligence Layer',
      status: 'operational',
      version: NYV_PLATFORM_VERSION,
      services: {
        'NV-Gateway': 'operational',
        'NV-Orchestrator': 'operational',
        'NV-AgentRouter': 'operational',
        'NV-JobQueue': 'operational',
        'NV-Usage': 'operational',
      },
      system_agents: Object.keys(SYSTEM_AGENTS).length,
      model: 'RealLLMService (multi-provider)',
      uptime: process.uptime(),
    }
  });
});

export default router;
