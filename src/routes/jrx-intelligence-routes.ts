// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
import { Router, Request, Response } from 'express';
import { nvAiCreditCap } from '../middleware/jrx-ai-credit-cap-middleware.js';
import { z } from 'zod';
import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';
import { realLLMService, type LLMRequest } from '../services/real-llm-service.js';
import { appendAuditRecord } from '../middleware/jrx-sdk-tracking-middleware.js';
import { nvConflictDetectorService } from '../services/intelligence/jrx-conflict-detector-service.js';
import { nvAmendmentImpactService } from '../services/intelligence/jrx-amendment-impact-service.js';
import { nvLitigationRiskV2Service } from '../services/intelligence/jrx-litigation-risk-v2-service.js';
import { nvPrecedentSimilarityService } from '../services/intelligence/jrx-precedent-similarity-service.js';
import { nvRegulatoryIntelligenceService } from '../services/intelligence/jrx-regulatory-intelligence-service.js';
import { nvSecureCollaborationService } from '../services/intelligence/jrx-secure-collaboration-service.js';
import { nvContractAnalysisV2Service } from '../services/jrx-contract-analysis-v2-service.js';
import { nvLegalNerV2Service } from '../services/jrx-legal-ner-v2-service.js';
import { partnerIndiaScopeMiddleware } from '../middleware/jrx-partner-india-scope.js';

const logger = createLogger('./jrx-intelligence-routes');
const router = Router();

router.use(partnerIndiaScopeMiddleware);

/* NV-CREDIT-UNIVERSAL-001 — pre-spend cap on this router's model-calling routes.
 * Mounted at both `/api/jrx/intelligence` and `/api/jrx/ai` behind `dualSdkOrJwt`,
 * so a partner API key reaches every one of them. The deterministic reads
 * (`/status`, `/regulatory-feed`, `/compliance-calendar`) stay uncapped. */
const intelCap = nvAiCreditCap({ agentKey: 'intelligence', completionAllowance: 2_048 });

router.get('/status', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '3.1.2',
    services: {
      conflictDetector: 'active',
      amendmentImpact: 'active',
      litigationRiskV2: 'active',
      precedentSimilarity: 'active',
      regulatoryIntelligence: 'active',
      secureCollaboration: 'active',
      contractAnalysisV2: 'active',
      legalNerV2: 'active',
    },
  });
});

router.post('/conflict-detect', intelCap, async (req: Request, res: Response) => {
  try {
    const { strategy, jurisdictions, context } = req.body;
    if (!strategy || !jurisdictions || !Array.isArray(jurisdictions)) {
      res.status(400).json({ error: 'strategy and jurisdictions[] are required' });
    }
    const result = await nvConflictDetectorService.detectConflicts(strategy, jurisdictions, { context });
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'conflict-detect', error: (error as Error).message });
    res.status(500).json({ error: 'Conflict detection failed' });
  }
});

router.post('/amendment-impact', intelCap, async (req: Request, res: Response) => {
  try {
    const sectionId = req.body.sectionId || req.body.amendmentId || req.body.changedSection || req.body.statuteId;
    const { jurisdiction, effectiveDate, amendmentId } = req.body;
    if (!sectionId || !jurisdiction) {
      return void res.status(400).json({ error: 'sectionId (or amendmentId) and jurisdiction are required' });
    }
    const result = await nvAmendmentImpactService.analyzeImpact(
      String(sectionId),
      jurisdiction,
      effectiveDate ? new Date(effectiveDate) : new Date(),
      { amendmentId: amendmentId || sectionId },
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'amendment-impact', error: (error as Error).message });
    res.status(500).json({ error: 'Amendment impact analysis failed' });
  }
});

router.post('/statute-history', intelCap, async (req: Request, res: Response) => {
  try {
    const sectionRef = req.body.sectionRef || req.body.statuteId || req.body.sectionId;
    const { jurisdiction } = req.body;
    if (!sectionRef || !jurisdiction) {
      return void res.status(400).json({ error: 'sectionRef (or statuteId) and jurisdiction are required' });
    }
    const result = await nvAmendmentImpactService.getStatuteHistory(sectionRef, jurisdiction);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'statute-history', error: (error as Error).message });
    res.status(500).json({ error: 'Statute history lookup failed' });
  }
});

router.post('/litigation-risk-v2', intelCap, async (req: Request, res: Response) => {
  try {
    const { caseDescription, jurisdiction, domain, claimAmount, judgeId, opposingCounselId, forum } = req.body;
    if (!caseDescription || !jurisdiction || !domain) {
      res.status(400).json({ error: 'caseDescription, jurisdiction, domain are required' });
    }
    const result = await nvLitigationRiskV2Service.assessRisk({
      caseDescription, jurisdiction, domain, claimAmount, judgeId, opposingCounselId, forum,
    });
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'litigation-risk-v2', error: (error as Error).message });
    res.status(500).json({ error: 'Litigation risk assessment failed' });
  }
});

router.get('/regulatory-feed', async (req: Request, res: Response) => {
  try {
    const jurisdiction = (req.query.jurisdiction as string) || 'IN';
    const limit = Number(req.query.limit || 50);
    const digest = await nvRegulatoryIntelligenceService.getRegulatoryDigest(jurisdiction as any, 30);
    res.json({
      success: true,
      data: {
        updates: digest.updates.slice(0, Number.isFinite(limit) ? limit : 50),
        jurisdiction,
        totalCount: digest.totalUpdates,
        lastFetchedAt: digest.generatedAt.toISOString(),
        source: digest.source,
        reason: digest.reason,
      },
    });
  } catch (error: any) {
    logger.error({ route: 'regulatory-feed', error: (error as Error).message });
    res.status(500).json({ error: 'Regulatory feed fetch failed' });
  }
});

router.post('/precedent-similarity', intelCap, async (req: Request, res: Response) => {
  try {
    // Accept both `caseDescription` (legacy) and `query` (used by
    // packages/client-sdk/src/api/IntelligenceApi.ts#findPrecedents).
    const { caseDescription, query, jurisdiction, maxResults, crossJurisdiction, domains } = req.body;
    const description = caseDescription ?? query;
    if (!description || !jurisdiction) {
      res.status(400).json({ error: 'query (or caseDescription) and jurisdiction are required' });
      return;
    }
    const result = await nvPrecedentSimilarityService.findSimilarPrecedents(
      description, jurisdiction, { maxResults, crossJurisdiction, domains }
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'precedent-similarity', error: (error as Error).message });
    res.status(500).json({ error: 'Precedent similarity search failed' });
  }
});

router.post('/regulatory-digest', intelCap, async (req: Request, res: Response) => {
  try {
    const { jurisdiction, days } = req.body;
    if (!jurisdiction) { res.status(400).json({ error: 'jurisdiction is required' }); return; }
    const result = await nvRegulatoryIntelligenceService.getRegulatoryDigest(jurisdiction, days || 30);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'regulatory-digest', error: (error as Error).message });
    res.status(500).json({ error: 'Regulatory digest failed' });
  }
});

router.get('/compliance-calendar', async (req: Request, res: Response) => {
  try {
    const jurisdiction = req.query.jurisdiction as string || 'IN';
    const result = await nvRegulatoryIntelligenceService.getComplianceCalendar(jurisdiction as any);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'compliance-calendar', error: (error as Error).message });
    res.status(500).json({ error: 'Compliance calendar failed' });
  }
});

router.post('/contract-analysis', intelCap, async (req: Request, res: Response) => {
  try {
    const { text, jurisdiction } = req.body;
    if (!text || !jurisdiction) {
      res.status(400).json({ error: 'text and jurisdiction are required' });
    }
    const result = await nvContractAnalysisV2Service.analyzeContract(text, jurisdiction);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'contract-analysis', error: (error as Error).message });
    res.status(500).json({ error: 'Contract analysis failed' });
  }
});

router.post('/legal-ner', intelCap, async (req: Request, res: Response) => {
  try {
    const { text, jurisdiction } = req.body;
    if (!text || !jurisdiction) {
      res.status(400).json({ error: 'text and jurisdiction are required' });
    }
    const result = await nvLegalNerV2Service.extractEntities(text, jurisdiction);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'legal-ner', error: (error as Error).message });
    res.status(500).json({ error: 'Legal NER extraction failed' });
  }
});

router.post('/secure-session/create', async (req: Request, res: Response) => {
  try {
    const { participants, options } = req.body;
    if (!participants || !Array.isArray(participants)) {
      res.status(400).json({ error: 'participants[] is required' });
    }
    const userId = (req as any).user?.id || 'unknown';
    const result = await nvSecureCollaborationService.createSecureSession(
      userId, participants, options || { privilegeProtected: false }
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'secure-session/create', error: (error as Error).message });
    res.status(500).json({ error: 'Secure session creation failed' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// B2 (task-175): Six general-purpose NLP routes wrapping the canonical LLM
// router via realLLMService.executeRequest (NV-LLM-001 single-router rule).
// Pages calling /api/jrx/intelligence/{classify,predict,sentiment,translate,
// ner,summarize} hit these wrappers; each handler emits a non-blocking
// nv_audit_logs entry per NV-ARCH-001.
// ────────────────────────────────────────────────────────────────────────────

interface NlpAuditMeta {
  route: string;
  userId?: string;
  orgId?: string;
  inputBytes: number;
  outputBytes: number;
  model?: string;
  provider?: string;
  latencyMs?: number;
  ok: boolean;
}

function fireAndForgetAudit(meta: NlpAuditMeta): void {
  setImmediate(async () => {
    try {
      await appendAuditRecord({
        eventType: `intelligence.${meta.route}`,
        payload: JSON.stringify({ ...meta, timestamp: new Date().toISOString() }),
        strict: false,
      });
    } catch (err: any) {
      logger.warn('intelligence_audit_failed', { route: meta.route, err: err?.message ?? String(err) });
    }
  });
}

function extractJson<T = any>(content: string): T | null {
  if (!content) return null;
  // Try direct parse first.
  try { return JSON.parse(content) as T; } catch { /* fall through */ }
  // Fenced ```json … ``` block.
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    try { return JSON.parse(fence[1]) as T; } catch { /* fall through */ }
  }
  // First { … } or [ … ] substring.
  const first = content.match(/[\[{][\s\S]*[\]}]/);
  if (first?.[0]) {
    try { return JSON.parse(first[0]) as T; } catch { /* ignore */ }
  }
  return null;
}

function reqContext(req: Request): { userId?: string; orgId?: string } {
  const u: any = (req as any).user ?? {};
  return { userId: u.id ?? u.userId, orgId: u.orgId ?? u.organizationId };
}

async function callRouter(opts: {
  systemPrompt: string;
  prompt: string;
  taskKind: string;
  domain: 'general' | 'analytical' | 'reasoning' | 'creative';
  complexity: 'simple' | 'medium' | 'complex' | 'expert';
  maxTokens?: number;
  expectJson?: boolean;
  userId?: string;
  organizationId?: string;
}) {
  const request: LLMRequest = {
    id: `nlp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    userId: opts.userId ?? 'anonymous',
    organizationId: opts.organizationId,
    prompt: opts.prompt,
    systemPrompt: opts.systemPrompt,
    maxTokens: opts.maxTokens ?? 1024,
    temperature: 0.2,
    expectJson: opts.expectJson ?? true,
    taskKind: opts.taskKind,
    requirements: {
      complexity: opts.complexity,
      domain: opts.domain,
      priority: 'medium',
      costBudget: 'balanced',
      responseTime: 'balanced',
      qualityLevel: 'professional',
    },
    fallbackLevels: 3,
    timestamp: new Date(),
  };

  const { executeWithFullSafetyRing } = await import('../orchestration/jrx-sdk-orchestration-wrapper.js');
  const wrapped = await executeWithFullSafetyRing(request, {
    sdkPlatform: 'intelligence',
    ctx: {
      userId: request.userId,
      organizationId: opts.organizationId,
      tenantId: opts.organizationId,
      tier: 'pro',
    },
    agentKey: 'auto',
    taskType: opts.taskKind,
    domainContext: `intelligence:${opts.taskKind}`,
    tier: 'pro',
    enableHITL: false,
    enableHallucinationCheck: true,
    enableCitationVerification: true,
    enableRAG: true,
    enableMemory: false,
  });
  return wrapped;
}

// ── /classify ───────────────────────────────────────────────────────────────
const ClassifySchema = z.object({
  text: z.string().min(1).max(50000),
  labels: z.array(z.string()).optional(),
});

router.post('/classify', intelCap, async (req: Request, res: Response) => {
  const ctx = reqContext(req);
  const t0 = Date.now();
  try {
    const body = ClassifySchema.parse(req.body);
    const labelHint = body.labels?.length
      ? `Choose from these candidate labels: ${body.labels.join(', ')}.`
      : 'Choose 1–5 short topical labels you deem most appropriate.';
    const sys =
      'You are a precise text-classification engine. ' +
      'Respond ONLY with compact JSON of shape {"labels":string[],"confidence":number} ' +
      'where confidence is in [0,1]. No prose, no markdown.';
    const prompt = `${labelHint}\n\nTEXT:\n${body.text}`;
    const llm = await callRouter({
      systemPrompt: sys, prompt, taskKind: 'classify', domain: 'analytical',
      complexity: 'simple', maxTokens: 256, userId: ctx.userId, organizationId: ctx.orgId,
    });
    const parsed = extractJson<{ labels: string[]; confidence: number }>(llm.content) ?? {
      labels: body.labels?.slice(0, 1) ?? ['unclassified'],
      confidence: 0,
    };
    const data = {
      labels: Array.isArray(parsed.labels) ? parsed.labels.map(String) : [],
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
    };
    fireAndForgetAudit({
      route: 'classify', ...ctx, inputBytes: body.text.length, outputBytes: llm.content.length,
      model: llm.model, provider: llm.provider, latencyMs: Date.now() - t0, ok: true,
    });
    res.json(data);
  } catch (error: any) {
    fireAndForgetAudit({
      route: 'classify', ...ctx, inputBytes: JSON.stringify(req.body ?? {}).length,
      outputBytes: 0, latencyMs: Date.now() - t0, ok: false,
    });
    if (error?.issues) { res.status(400).json({ error: 'Invalid input', details: error.issues }); return; }
    logger.error({ route: 'classify', error: (error as Error).message });
    res.status(500).json({ error: 'Classification failed' });
  }
});

// ── /predict ────────────────────────────────────────────────────────────────
const PredictSchema = z.object({
  text: z.string().min(1).max(50000),
  question: z.string().max(2000).optional(),
  context: z.string().max(20000).optional(),
});

router.post('/predict', intelCap, async (req: Request, res: Response) => {
  const ctx = reqContext(req);
  const t0 = Date.now();
  try {
    const body = PredictSchema.parse(req.body);
    const sys =
      'You are a careful prediction engine. Read the input and produce a single best prediction ' +
      'with a confidence score and a one-paragraph reasoning trace. ' +
      'Respond ONLY with compact JSON: {"prediction":string,"confidence":number,"reasoning":string}.';
    const prompt = [
      body.context ? `CONTEXT:\n${body.context}` : null,
      body.question ? `QUESTION:\n${body.question}` : null,
      `INPUT:\n${body.text}`,
    ].filter(Boolean).join('\n\n');
    const llm = await callRouter({
      systemPrompt: sys, prompt, taskKind: 'analysis', domain: 'reasoning',
      complexity: 'medium', maxTokens: 512, userId: ctx.userId, organizationId: ctx.orgId,
    });
    const parsed = extractJson<{ prediction: string; confidence: number; reasoning: string }>(llm.content) ?? {
      prediction: llm.content.trim().slice(0, 400) || 'unknown',
      confidence: 0,
      reasoning: 'LLM did not return parseable JSON; falling back to raw text.',
    };
    const data = {
      prediction: String(parsed.prediction ?? ''),
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
      reasoning: String(parsed.reasoning ?? ''),
    };
    fireAndForgetAudit({
      route: 'predict', ...ctx, inputBytes: prompt.length, outputBytes: llm.content.length,
      model: llm.model, provider: llm.provider, latencyMs: Date.now() - t0, ok: true,
    });
    res.json(data);
  } catch (error: any) {
    fireAndForgetAudit({
      route: 'predict', ...ctx, inputBytes: JSON.stringify(req.body ?? {}).length,
      outputBytes: 0, latencyMs: Date.now() - t0, ok: false,
    });
    if (error?.issues) { res.status(400).json({ error: 'Invalid input', details: error.issues }); return; }
    logger.error({ route: 'predict', error: (error as Error).message });
    res.status(500).json({ error: 'Prediction failed' });
  }
});

// ── /sentiment ──────────────────────────────────────────────────────────────
const SentimentSchema = z.object({
  text: z.string().min(1).max(50000),
});

router.post('/sentiment', intelCap, async (req: Request, res: Response) => {
  const ctx = reqContext(req);
  const t0 = Date.now();
  try {
    const body = SentimentSchema.parse(req.body);
    const sys =
      'You are a sentiment analysis engine. Classify the dominant sentiment of the input text. ' +
      'Respond ONLY with compact JSON: {"sentiment":"positive"|"neutral"|"negative","score":number} ' +
      'where score is in [-1,1] (-1 strongly negative, 0 neutral, 1 strongly positive).';
    const llm = await callRouter({
      systemPrompt: sys, prompt: body.text, taskKind: 'sentiment', domain: 'analytical',
      complexity: 'simple', maxTokens: 128, userId: ctx.userId, organizationId: ctx.orgId,
    });
    const parsed = extractJson<{ sentiment: string; score: number }>(llm.content) ?? {
      sentiment: 'neutral', score: 0,
    };
    const sentiment = ['positive', 'neutral', 'negative'].includes(String(parsed.sentiment))
      ? (parsed.sentiment as 'positive' | 'neutral' | 'negative')
      : 'neutral';
    const data = {
      sentiment,
      score: typeof parsed.score === 'number' ? Math.max(-1, Math.min(1, parsed.score)) : 0,
    };
    fireAndForgetAudit({
      route: 'sentiment', ...ctx, inputBytes: body.text.length, outputBytes: llm.content.length,
      model: llm.model, provider: llm.provider, latencyMs: Date.now() - t0, ok: true,
    });
    res.json(data);
  } catch (error: any) {
    fireAndForgetAudit({
      route: 'sentiment', ...ctx, inputBytes: JSON.stringify(req.body ?? {}).length,
      outputBytes: 0, latencyMs: Date.now() - t0, ok: false,
    });
    if (error?.issues) { res.status(400).json({ error: 'Invalid input', details: error.issues }); return; }
    logger.error({ route: 'sentiment', error: (error as Error).message });
    res.status(500).json({ error: 'Sentiment analysis failed' });
  }
});

// ── /translate ──────────────────────────────────────────────────────────────
const TranslateSchema = z.object({
  text: z.string().min(1).max(20000),
  targetLang: z.string().min(2).max(20),
  sourceLang: z.string().min(2).max(20).optional(),
});

router.post('/translate', intelCap, async (req: Request, res: Response) => {
  const ctx = reqContext(req);
  const t0 = Date.now();
  try {
    const body = TranslateSchema.parse(req.body);
    const src = body.sourceLang ?? 'auto';
    const sys =
      'You are a precise legal-aware translator. Translate the user text into the target language ' +
      'preserving legal terms, citations, and proper nouns. ' +
      'Respond ONLY with compact JSON: {"translated":string,"sourceLang":string,"targetLang":string}. ' +
      'If sourceLang is "auto", detect and return the ISO code.';
    const prompt = `SOURCE_LANG: ${src}\nTARGET_LANG: ${body.targetLang}\n\nTEXT:\n${body.text}`;
    const llm = await callRouter({
      systemPrompt: sys, prompt, taskKind: 'translation', domain: 'general',
      complexity: 'medium', maxTokens: Math.min(4096, Math.ceil(body.text.length / 2) + 256),
      userId: ctx.userId, organizationId: ctx.orgId,
    });
    const parsed = extractJson<{ translated: string; sourceLang: string; targetLang: string }>(llm.content) ?? {
      translated: llm.content.trim(),
      sourceLang: src,
      targetLang: body.targetLang,
    };
    const data = {
      translated: String(parsed.translated ?? ''),
      sourceLang: String(parsed.sourceLang ?? src),
      targetLang: String(parsed.targetLang ?? body.targetLang),
    };
    fireAndForgetAudit({
      route: 'translate', ...ctx, inputBytes: body.text.length, outputBytes: llm.content.length,
      model: llm.model, provider: llm.provider, latencyMs: Date.now() - t0, ok: true,
    });
    res.json(data);
  } catch (error: any) {
    fireAndForgetAudit({
      route: 'translate', ...ctx, inputBytes: JSON.stringify(req.body ?? {}).length,
      outputBytes: 0, latencyMs: Date.now() - t0, ok: false,
    });
    if (error?.issues) { res.status(400).json({ error: 'Invalid input', details: error.issues }); return; }
    logger.error({ route: 'translate', error: (error as Error).message });
    res.status(500).json({ error: 'Translation failed' });
  }
});

// ── /ner ────────────────────────────────────────────────────────────────────
const NerSchema = z.object({
  text: z.string().min(1).max(50000),
  types: z.array(z.string()).optional(),
});

router.post('/ner', intelCap, async (req: Request, res: Response) => {
  const ctx = reqContext(req);
  const t0 = Date.now();
  try {
    const body = NerSchema.parse(req.body);
    const typeHint = body.types?.length
      ? `Restrict entity types to: ${body.types.join(', ')}.`
      : 'Use canonical entity types (PERSON, ORG, LOCATION, DATE, MONEY, LAW, CASE, COURT, STATUTE, MISC).';
    const sys =
      'You are a Named Entity Recognition engine. Extract entities with character offsets. ' +
      `${typeHint} ` +
      'Respond ONLY with compact JSON: {"entities":[{"type":string,"value":string,"start":number,"end":number}]}. ' +
      'start/end are 0-indexed character positions in the input text.';
    const llm = await callRouter({
      systemPrompt: sys, prompt: body.text, taskKind: 'ner', domain: 'analytical',
      complexity: 'medium', maxTokens: 1024, userId: ctx.userId, organizationId: ctx.orgId,
    });
    const parsed = extractJson<{ entities: Array<{ type: string; value: string; start: number; end: number }> }>(llm.content)
      ?? { entities: [] };
    const entities = (Array.isArray(parsed.entities) ? parsed.entities : []).map((e: any) => ({
      type: String(e?.type ?? 'MISC'),
      value: String(e?.value ?? ''),
      start: Number.isFinite(e?.start) ? Number(e.start) : 0,
      end: Number.isFinite(e?.end) ? Number(e.end) : 0,
    }));
    fireAndForgetAudit({
      route: 'ner', ...ctx, inputBytes: body.text.length, outputBytes: llm.content.length,
      model: llm.model, provider: llm.provider, latencyMs: Date.now() - t0, ok: true,
    });
    res.json({ entities });
  } catch (error: any) {
    fireAndForgetAudit({
      route: 'ner', ...ctx, inputBytes: JSON.stringify(req.body ?? {}).length,
      outputBytes: 0, latencyMs: Date.now() - t0, ok: false,
    });
    if (error?.issues) { res.status(400).json({ error: 'Invalid input', details: error.issues }); return; }
    logger.error({ route: 'ner', error: (error as Error).message });
    res.status(500).json({ error: 'NER extraction failed' });
  }
});

// ── /summarize ──────────────────────────────────────────────────────────────
const SummarizeSchema = z.object({
  text: z.string().min(1).max(100000),
  maxBullets: z.number().int().min(1).max(20).optional(),
});

router.post('/summarize', intelCap, async (req: Request, res: Response) => {
  const ctx = reqContext(req);
  const t0 = Date.now();
  try {
    const body = SummarizeSchema.parse(req.body);
    const bullets = body.maxBullets ?? 5;
    const sys =
      'You are a concise summarisation engine. Produce a 2–4 sentence summary plus ' +
      `up to ${bullets} bullet points covering the key facts/findings/decisions. ` +
      'Respond ONLY with compact JSON: {"summary":string,"bulletPoints":string[]}.';
    const llm = await callRouter({
      systemPrompt: sys, prompt: body.text, taskKind: 'summarize', domain: 'analytical',
      complexity: 'medium', maxTokens: 1024, userId: ctx.userId, organizationId: ctx.orgId,
    });
    const parsed = extractJson<{ summary: string; bulletPoints: string[] }>(llm.content) ?? {
      summary: llm.content.trim().slice(0, 800),
      bulletPoints: [],
    };
    const data = {
      summary: String(parsed.summary ?? ''),
      bulletPoints: Array.isArray(parsed.bulletPoints) ? parsed.bulletPoints.map(String).slice(0, bullets) : [],
    };
    fireAndForgetAudit({
      route: 'summarize', ...ctx, inputBytes: body.text.length, outputBytes: llm.content.length,
      model: llm.model, provider: llm.provider, latencyMs: Date.now() - t0, ok: true,
    });
    res.json(data);
  } catch (error: any) {
    fireAndForgetAudit({
      route: 'summarize', ...ctx, inputBytes: JSON.stringify(req.body ?? {}).length,
      outputBytes: 0, latencyMs: Date.now() - t0, ok: false,
    });
    if (error?.issues) { res.status(400).json({ error: 'Invalid input', details: error.issues }); return; }
    logger.error({ route: 'summarize', error: (error as Error).message });
    res.status(500).json({ error: 'Summarization failed' });
  }
});

export default router;
