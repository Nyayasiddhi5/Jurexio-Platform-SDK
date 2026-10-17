// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * Jurexio Enterprise Platform 3.1.2 — SDK Intelligence Routes
 * NYV-SDK-INTELLIGENCE-001
 *
 * 10 AI-first intelligence endpoints powering Jurexio Professional
 * and any third-party legal platform consuming the Jurexio Enterprise Platform SDK.
 *
 * Architecture:
 *  - All AI via callJurexio / callJurexioOrchestrate (never direct LLM)
 *  - Auth: sdkGatewayAuth (API-key-based SDK auth)
 *  - Guardrails: prompt + response enforcement on every call
 *  - Caching: Redis (lazy-import) with per-endpoint TTLs
 *  - Validation: Zod schemas on every request body
 *  - Hybrid scoring: rule-based fast path + AI deep analysis
 *  - PII: redaction before any LLM call (via nv-client pipeline)
 *  - Observability: structured JSON logging on every call
 *  - Error surface: never leaks internal stack traces
 *
 * Endpoints:
 *  POST /api/jrx/v1/sdk/intelligence/dashboard-insights       (E1)
 *  POST /api/jrx/v1/sdk/intelligence/case-risk-analysis       (E2)
 *  POST /api/jrx/v1/sdk/intelligence/predict-outcome          (E3)
 *  POST /api/jrx/v1/sdk/intelligence/suggest-invoice-items    (E4)
 *  POST /api/jrx/v1/sdk/intelligence/hearing-prep-checklist   (E5)
 *  POST /api/jrx/v1/sdk/intelligence/classify-document        (E6)
 *  POST /api/jrx/v1/sdk/intelligence/sentiment-analysis       (E7)
 *  POST /api/jrx/v1/sdk/intelligence/legal-research           (E8)
 *  POST /api/jrx/v1/sdk/intelligence/translate-legal          (E9)
 *  POST /api/jrx/v1/sdk/intelligence/portfolio-risk-analysis  (E10)
 *  GET  /api/jrx/v1/sdk/intelligence/client-health/:clientId  (D7)
 *  GET  /api/jrx/v1/sdk/intelligence/capabilities             (meta)
 */

import { Router, Request, Response } from 'express';
import { nvAiCreditCap } from '../middleware/jrx-ai-credit-cap-middleware.js';
import { z } from 'zod';
import crypto from 'crypto';
import { callJurexio } from '../services/jrx-client.js';
import { sdkGatewayAuth } from '../middleware/sdk-gateway.js';
import { tenantIsolation } from '../middleware/jrx-tenant-isolation.js';
import {
  guardrailEnforcementMiddleware,
  responseGuardrailMiddleware,
} from '../middleware/guardrails-enforcement.js';
import { createLogger } from '../utils/logger.js';
import { secureRandomHex } from '../utils/jrx-secure-random.js';
import { NYV_PLATFORM_VERSION } from '../config/nyv-master-config.js';
import { getRegistryStats } from '../services/agent-registry-service.js';

const logger = createLogger('sdk-intelligence');

// ─── Redis Cache (lazy import — graceful fallback) ───────────────────────────

type CacheGetFn = <T>(key: string) => Promise<T | null>;
type CacheSetFn = (key: string, value: unknown, ttlSeconds: number) => Promise<void>;

let _cacheGet: CacheGetFn | null = null;
let _cacheSet: CacheSetFn | null = null;

async function getCacheFns(): Promise<{ get: CacheGetFn; set: CacheSetFn } | null> {
  if (_cacheGet && _cacheSet) return { get: _cacheGet, set: _cacheSet };
  try {
    const mod = await import('../services/redis-cache.js');
    _cacheGet = mod.cacheGet as CacheGetFn;
    _cacheSet = mod.cacheSet as CacheSetFn;
    return { get: _cacheGet, set: _cacheSet };
  } catch {
    return null;
  }
}

async function cacheGet<T>(key: string): Promise<T | null> {
  const fns = await getCacheFns();
  if (!fns) return null;
  try { return await fns.get<T>(key); } catch { return null; }
}

async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const fns = await getCacheFns();
  if (!fns) return;
  try { await fns.set(key, value, ttlSeconds); } catch { /* cache miss is non-fatal */ }
}

// ─── DB (lazy import — Neon serverless) ──────────────────────────────────────

async function getDb() {
  const { neon } = await import('@neondatabase/serverless');
  return neon(process.env.DATABASE_URL!);
}

// ─── Platform version ────────────────────────────────────────────────────────

const PLATFORM_VERSION = NYV_PLATFORM_VERSION;

// ─── Request context helper ──────────────────────────────────────────────────

interface IntelligenceContext {
  requestId: string;
  orgId: string;
  appId: string;
  tier: string;
  jurisdiction?: string;
}

function extractContext(req: Request): IntelligenceContext {
  const ctx = (req as any).sdkContext || {};
  return {
    requestId: secureRandomHex(8),
    orgId: ctx.orgId || ctx.tenantId || 'unknown',
    appId: ctx.applicationId || 'unknown',
    tier: ctx.tier || 'standard',
    jurisdiction: ctx.jurisdiction,
  };
}

// ─── Standard error envelope ──────────────────────────────────────────────────

function errResponse(res: Response, status: number, code: string, message: string, meta?: object) {
  res.status(status).json({
    success: false,
    error: { code, message, ...(meta || {}) },
    platform: PLATFORM_VERSION,
  });
}

/**
 * NV-SDK-ERROR-ENVELOPE-2026-05-11 (Session-15 v14).
 *
 * Partner-facing 502 envelope improvement. Before this change every
 * intelligence catch returned an opaque `{ code: AI_UNAVAILABLE,
 * message: "<surface> temporarily unavailable." }` — partners had no
 * way to tell a transient upstream LLM 503 apart from a guardrails
 * `policy_violation` (which is NOT retryable and means the prompt
 * itself is the problem). The catch chain that produced the user's
 * NSP 502 went: legal-analyst → guardrails BANNED_CONTENT →
 * callJurexio throws → caught here → 502 AI_UNAVAILABLE with no
 * cause hint.
 *
 * This helper classifies the underlying error into one of:
 *   - POLICY_VIOLATION  (4xx-equivalent — caller must change input)
 *   - LLM_PROVIDER_5XX  (retryable upstream)
 *   - LLM_RATE_LIMIT    (retryable with backoff)
 *   - LLM_TIMEOUT       (retryable)
 *   - LLM_ALL_PROVIDERS_EXHAUSTED (retryable with longer backoff)
 *   - AI_UNKNOWN        (catch-all, retryable)
 * and emits a richer envelope with `cause`, `retryable`, `requestId`,
 * `docs_url` so partner SDKs can branch correctly.
 *
 * The HTTP status stays 502 for runtime failures (preserves existing
 * SDK retry behaviour) and switches to 422 for POLICY_VIOLATION (so
 * partners stop retrying a prompt that will never succeed).
 */
interface AiErrorClassification {
  status: number;
  code: string;
  cause: string;
  retryable: boolean;
  retry_after_seconds?: number;
}
function classifyAiError(err: unknown): AiErrorClassification {
  const msg = String((err as any)?.message ?? err ?? '');
  const m = msg.toLowerCase();
  if (m.includes('policy_violation') || m.includes('banned_content') ||
      m.includes('banned content') || m.includes('blocked by guardrail')) {
    return {
      status: 422, code: 'POLICY_VIOLATION', cause: 'guardrails-banned-content',
      retryable: false,
    };
  }
  if (m.includes('rate limit') || m.includes('rate_limit') || m.includes(' 429')) {
    return {
      status: 502, code: 'LLM_RATE_LIMIT', cause: 'upstream-rate-limit',
      retryable: true, retry_after_seconds: 30,
    };
  }
  if (m.includes('timeout') || m.includes('etimedout') || m.includes('timed out')) {
    return { status: 502, code: 'LLM_TIMEOUT', cause: 'upstream-timeout', retryable: true };
  }
  if (m.includes('all providers') || m.includes('exhausted') || m.includes('no provider')) {
    return {
      status: 502, code: 'LLM_ALL_PROVIDERS_EXHAUSTED',
      cause: 'fallback-chain-exhausted', retryable: true, retry_after_seconds: 60,
    };
  }
  if (/\b(5\d\d)\b/.test(msg)) {
    return { status: 502, code: 'LLM_PROVIDER_5XX', cause: 'upstream-5xx', retryable: true };
  }
  return { status: 502, code: 'AI_UNAVAILABLE', cause: 'ai-unknown', retryable: true };
}
function aiErrorResponse(res: Response, requestId: string, surface: string, err: unknown): void {
  const c = classifyAiError(err);
  const isPolicy = c.code === 'POLICY_VIOLATION';
  const message = isPolicy
    ? `${surface}: request rejected by guardrails. Modify the prompt to remove banned-content patterns and retry.`
    : `${surface} temporarily unavailable.`;
  errResponse(res, c.status, c.code, message, {
    cause: c.cause,
    retryable: c.retryable,
    ...(c.retry_after_seconds ? { retry_after_seconds: c.retry_after_seconds } : {}),
    requestId,
    docs_url: 'https://docs.jurexio.example/canonical/04c-sdk-troubleshooting',
  });
}

// ─── Zod validation helper ────────────────────────────────────────────────────

function validate<T>(schema: z.ZodSchema<T>, body: unknown, res: Response): T | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
    errResponse(res, 400, 'VALIDATION_ERROR', issues.join('; '));
    return null;
  }
  return result.data;
}

// ─── Hybrid risk scoring (fast rule-based path) ───────────────────────────────

interface CaseRiskInput {
  case_type?: string;
  jurisdiction?: string;
  hearing_date?: string;
  documents?: unknown[];
  assigned_lawyer_id?: string | null;
  last_client_contact_days?: number;
  opposing_counsel?: string;
  last_order_date?: string;
}

function quickRiskScore(c: CaseRiskInput): {
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  score: number;
  breakdown: Record<string, number>;
} {
  let score = 0;
  const breakdown: Record<string, number> = {};

  if (c.hearing_date) {
    const daysToHearing = Math.max(
      0,
      Math.floor((new Date(c.hearing_date).getTime() - Date.now()) / 86_400_000)
    );
    if (daysToHearing < 3) { score += 40; breakdown.imminent_hearing = 40; }
    else if (daysToHearing < 7) { score += 30; breakdown.upcoming_hearing = 30; }
    else if (daysToHearing < 14) { score += 15; breakdown.near_hearing = 15; }
  }

  if (!c.assigned_lawyer_id) { score += 25; breakdown.no_assigned_lawyer = 25; }

  const docCount = Array.isArray(c.documents) ? c.documents.length : 0;
  if (docCount === 0) { score += 20; breakdown.no_documents = 20; }
  else if (docCount < 2) { score += 10; breakdown.sparse_documents = 10; }

  if ((c.last_client_contact_days ?? 0) > 30) { score += 10; breakdown.stale_client_contact = 10; }
  if ((c.last_client_contact_days ?? 0) > 60) { score += 5; breakdown.very_stale_contact = 5; }

  if (!c.last_order_date) { score += 5; breakdown.no_last_order = 5; }

  const clamped = Math.min(score, 100);
  return {
    score: clamped,
    level: clamped >= 60 ? 'HIGH' : clamped >= 30 ? 'MEDIUM' : 'LOW',
    breakdown,
  };
}

// ─── Legal term preservation for translation ─────────────────────────────────

const PRESERVED_LEGAL_TERMS = new Set([
  'Vakalatnama', 'vakalatnama', 'suo motu', 'prima facie', 'locus standi',
  'amicus curiae', 'inter alia', 'res judicata', 'stare decisis', 'obiter dicta',
  'ratio decidendi', 'ex parte', 'in limine', 'certiorari', 'mandamus',
  'habeas corpus', 'caveat', 'affidavit', 'subpoena', 'pro bono',
  'ultra vires', 'intra vires', 'nemo judex', 'audi alteram partem',
  'Vakil', 'Munsiff', 'Tehsildar', 'patta', 'namdaar',
]);

function extractPreservedTerms(text: string): string[] {
  const found: string[] = [];
  for (const term of PRESERVED_LEGAL_TERMS) {
    if (text.includes(term)) found.push(term);
  }
  return found;
}

// ─── Document checklist required items ───────────────────────────────────────

const STANDARD_HEARING_DOCS = [
  { id: 'vakalatnama', label: 'Vakalatnama', critical: true },
  { id: 'written_arguments', label: 'Written Arguments', critical: true },
  { id: 'list_of_dates', label: 'List of Dates', critical: false },
  { id: 'reply_to_opposition', label: 'Reply to Opposition Submissions', critical: false },
  { id: 'affidavit', label: 'Affidavit / Sworn Statement', critical: false },
  { id: 'evidence_documents', label: 'Evidence & Exhibit Bundle', critical: false },
];

// ─── Request schemas ──────────────────────────────────────────────────────────

const DashboardInsightsSchema = z.object({
  active_cases: z.number().int().nonnegative().optional().default(0),
  upcoming_hearings: z.array(z.object({
    case_id: z.string(),
    case_title: z.string(),
    hearing_date: z.string(),
    court: z.string().optional(),
  })).optional().default([]),
  overdue_invoices: z.array(z.object({
    invoice_id: z.string(),
    client_name: z.string(),
    amount: z.number(),
    overdue_days: z.number(),
  })).optional().default([]),
  unassigned_cases: z.number().int().nonnegative().optional().default(0),
  team_capacity: z.object({
    total_lawyers: z.number().optional(),
    avg_caseload: z.number().optional(),
  }).optional(),
  org_id: z.string().optional(),
});

const CaseRiskSchema = z.object({
  case_id: z.string().optional(),
  case_type: z.string().optional(),
  jurisdiction: z.string().optional(),
  hearing_date: z.string().optional(),
  documents: z.array(z.object({ id: z.string(), type: z.string().optional() })).optional().default([]),
  assigned_lawyer_id: z.string().nullable().optional(),
  last_client_contact_days: z.number().nonnegative().optional().default(0),
  opposing_counsel: z.string().optional(),
  last_order_date: z.string().optional(),
  analysis_depth: z.enum(['fast', 'deep']).optional().default('deep'),
});

const PredictOutcomeSchema = z.object({
  case_type: z.string().min(1),
  jurisdiction: z.string().min(1),
  facts_summary: z.string().min(10).max(8000),
  opposing_arguments: z.string().optional(),
  judge_name: z.string().optional(),
  case_history: z.string().optional(),
  relief_sought: z.string().optional(),
});

const SuggestInvoiceSchema = z.object({
  case_id: z.string().min(1),
  jurisdiction: z.string().optional(),
  timeline_events: z.array(z.object({
    event_type: z.string(),
    description: z.string(),
    date: z.string(),
    duration_hours: z.number().optional(),
  })).optional().default([]),
  standard_rates: z.object({
    court_appearance: z.number().optional(),
    drafting_per_hour: z.number().optional(),
    research_per_hour: z.number().optional(),
    consultation: z.number().optional(),
  }).optional().default({}),
  currency: z.string().optional().default('INR'),
});

const HearingPrepSchema = z.object({
  case_id: z.string().min(1),
  hearing_date: z.string().min(1),
  case_type: z.string().optional(),
  jurisdiction: z.string().optional(),
  court: z.string().optional(),
  documents: z.array(z.object({
    id: z.string(),
    type: z.string().optional(),
    file_name: z.string().optional(),
    uploaded_at: z.string().optional(),
  })).optional().default([]),
  case_title: z.string().optional(),
});

const ClassifyDocumentSchema = z.object({
  text: z.string().min(10).max(50000),
  file_name: z.string().optional(),
  document_id: z.string().optional(),
  case_context: z.object({
    case_type: z.string().optional(),
    court: z.string().optional(),
    parties: z.array(z.string()).optional(),
    jurisdiction: z.string().optional(),
  }).optional(),
  store_result: z.boolean().optional().default(true),
});

const SentimentSchema = z.object({
  messages: z.array(z.object({
    id: z.string().optional(),
    text: z.string().min(1),
    sender: z.enum(['client', 'lawyer', 'system']).optional(),
    sent_at: z.string().optional(),
  })).min(1).max(50),
  client_id: z.string().optional(),
});

const LegalResearchSchema = z.object({
  query: z.string().min(3).max(2000),
  jurisdiction: z.string().optional().default('IN'),
  act_preference: z.array(z.string()).optional().default([]),
  include_precedents: z.boolean().optional().default(true),
  language: z.string().optional().default('en'),
  max_results: z.number().int().min(1).max(20).optional().default(10),
  date_range: z.object({ from: z.string().optional(), to: z.string().optional() }).optional(),
});

const TranslateLegalSchema = z.object({
  text: z.string().min(5).max(20000),
  source_language: z.string().min(2).max(10),
  target_language: z.string().min(2).max(10),
  preserve_legal_terms: z.boolean().optional().default(true),
  document_type: z.string().optional(),
  formality: z.enum(['formal', 'neutral', 'plain']).optional().default('formal'),
});

const PortfolioRiskSchema = z.object({
  cases: z.array(z.object({
    id: z.string(),
    client_id: z.string().optional(),
    case_type: z.string().optional(),
    status: z.string().optional(),
    value: z.number().optional(),
    jurisdiction: z.string().optional(),
    assigned_lawyer_id: z.string().optional(),
  })).min(1).max(500),
  billing_history: z.array(z.object({
    client_id: z.string(),
    total_billed: z.number(),
    total_paid: z.number(),
    outstanding: z.number(),
  })).optional().default([]),
  clients: z.array(z.object({
    id: z.string(),
    name: z.string(),
    risk_level: z.string().optional(),
  })).optional().default([]),
  team_metrics: z.object({
    total_lawyers: z.number().optional(),
    avg_caseload: z.number().optional(),
    burnout_risk: z.string().optional(),
  }).optional(),
  jurisdiction: z.string().optional().default('IN'),
});

// ─── Router setup ─────────────────────────────────────────────────────────────

const router = Router();

router.use(sdkGatewayAuth);
router.use(tenantIsolation);
router.use(guardrailEnforcementMiddleware);
router.use(responseGuardrailMiddleware);

/* NV-CREDIT-UNIVERSAL-001 — pre-spend cap on the model-calling routes only.
 * The GET reads in this router (`/capabilities`, `/client-health`,
 * `/firm-snapshot`) are deterministic DB rollups, so they stay uncapped: a cap
 * there would refuse a free read once a budget was spent. */
const sdkIntelCap = nvAiCreditCap({ agentKey: 'sdk:intelligence', completionAllowance: 4_096 });

// ─── Capabilities endpoint (discovery, no AI call) ───────────────────────────

router.get('/capabilities', (_req: Request, res: Response): void => {
  res.json({
    success: true,
    platform: PLATFORM_VERSION,
    intelligence_api_version: 'v1',
    endpoints: [
      { id: 'E1',  path: '/dashboard-insights',      method: 'POST', cache_ttl_sec: 300,  tier: 'plus+' },
      { id: 'E2',  path: '/case-risk-analysis',       method: 'POST', cache_ttl_sec: 600,  tier: 'solo+' },
      { id: 'E3',  path: '/predict-outcome',          method: 'POST', cache_ttl_sec: 3600, tier: 'pro+'  },
      { id: 'E4',  path: '/suggest-invoice-items',    method: 'POST', cache_ttl_sec: 0,    tier: 'plus+' },
      { id: 'E5',  path: '/hearing-prep-checklist',   method: 'POST', cache_ttl_sec: 900,  tier: 'solo+' },
      { id: 'E6',  path: '/classify-document',        method: 'POST', cache_ttl_sec: 86400,tier: 'solo+' },
      { id: 'E7',  path: '/sentiment-analysis',       method: 'POST', cache_ttl_sec: 3600, tier: 'plus+' },
      { id: 'E8',  path: '/legal-research',           method: 'POST', cache_ttl_sec: 3600, tier: 'solo+' },
      { id: 'E9',  path: '/translate-legal',          method: 'POST', cache_ttl_sec: 86400,tier: 'solo+' },
      { id: 'E10', path: '/portfolio-risk-analysis',  method: 'POST', cache_ttl_sec: 0,    tier: 'pro+'  },
      { id: 'D7',  path: '/client-health/:clientId',  method: 'GET',  cache_ttl_sec: 3600, tier: 'plus+' },
    ],
    agents_available: getRegistryStats().totalAgents,
    jurisdictions: ['IN', 'UK', 'US', 'EU', 'SG', 'GC'],
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// E1 — Dashboard Intelligence Insights
// Aggregates firm-wide signals into actionable alerts + AI narrative
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.post('/dashboard-insights', sdkIntelCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = extractContext(req);
  const body = validate(DashboardInsightsSchema, req.body, res);
  if (!body) return;

  const orgId = body.org_id || ctx.orgId;
  const cacheKey = `sdk:intel:dashboard:${orgId}`;

  const cached = await cacheGet<object>(cacheKey);
  if (cached) {
    logger.info('E1 dashboard-insights cache hit', { orgId, requestId: ctx.requestId });
    res.json({ success: true, cached: true, ...cached });
    return;
  }

  logger.info('E1 dashboard-insights', { requestId: ctx.requestId, orgId });

  const upcomingStr = (body.upcoming_hearings ?? []).length
    ? (body.upcoming_hearings ?? [])
        .map(h => `• ${h.case_title} — ${h.court || 'Court TBD'} on ${h.hearing_date}`)
        .join('\n')
    : 'None scheduled in the next 7 days.';

  const overdueStr = (body.overdue_invoices ?? []).length
    ? (body.overdue_invoices ?? [])
        .map(i => `• ${i.client_name}: ₹${i.amount.toLocaleString()} overdue by ${i.overdue_days} days`)
        .join('\n')
    : 'No overdue invoices.';

  const systemPrompt = `You are the Chief Legal Intelligence Officer for a law firm using Jurexio AI Platform v${PLATFORM_VERSION}.
Your role: Analyse the firm's daily operational snapshot and produce a concise executive briefing.
Rules:
- Produce a JSON object with keys: alerts (array of { severity: HIGH|MEDIUM|LOW, category: string, message: string, action: string }), recommendations (array of { priority: number, title: string, detail: string, action_link: string }), ai_summary (string, 2-3 sentences).
- Alerts are actionable, specific, ranked by severity.
- Recommendations address the most impactful improvements.
- ai_summary is for the partner reading the morning dashboard.
- Respond ONLY with the JSON object, no markdown fences.`;

  const userPrompt = `Firm dashboard snapshot for ${new Date().toLocaleDateString('en-IN')}:

Active cases: ${body.active_cases}
Unassigned cases: ${(body.unassigned_cases ?? 0)}
${body.team_capacity ? `Team: ${body.team_capacity.total_lawyers} lawyers, avg ${body.team_capacity.avg_caseload} cases each` : ''}

Upcoming hearings:
${upcomingStr}

Overdue invoices:
${overdueStr}

Produce the executive briefing JSON.`;

  try {
    const result = await callJurexio('chief-legal-officer', systemPrompt, userPrompt, {
      maxTokens: 1500,
      source: 'sdk-intelligence',
      tenantId: orgId,
      taskType: 'dashboard-intelligence',
      tier: ctx.tier as any,
      enableHallucinationCheck: false,
    });

    let parsed: { alerts: unknown[]; recommendations: unknown[]; ai_summary: string };
    try {
      const clean = result.content.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = {
        alerts: (body.unassigned_cases ?? 0) > 0
          ? [{ severity: 'HIGH', category: 'Case Management', message: `${(body.unassigned_cases ?? 0)} cases unassigned`, action: 'Assign lawyers to these cases immediately' }]
          : [],
        recommendations: [{ priority: 1, title: 'Review upcoming hearings', detail: 'Ensure all hearing preparations are complete', action_link: '/calendar' }],
        ai_summary: result.content.slice(0, 400),
      };
    }

    const payload = {
      data: parsed,
      generated_at: new Date().toISOString(),
      platform: PLATFORM_VERSION,
      requestId: ctx.requestId,
    };

    await cacheSet(cacheKey, payload, 300);
    res.json({ success: true, cached: false, ...payload });
  } catch (err: any) {
    logger.info('E1 error', { requestId: ctx.requestId, error: err.message });
    aiErrorResponse(res, ctx.requestId, 'Dashboard intelligence', err);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// E2 — Case Risk Analysis (Hybrid: rule-based fast path + AI deep analysis)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.post('/case-risk-analysis', sdkIntelCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = extractContext(req);
  const body = validate(CaseRiskSchema, req.body, res);
  if (!body) return;

  logger.info('E2 case-risk-analysis', { requestId: ctx.requestId, caseId: body.case_id, depth: body.analysis_depth });

  const fastPath = quickRiskScore(body);

  if (body.analysis_depth === 'fast') {
    res.json({
      success: true,
      data: {
        risk_level: fastPath.level,
        score: fastPath.score,
        mode: 'fast',
        factors: Object.entries(fastPath.breakdown).map(([k, v]) => ({
          factor: k.replace(/_/g, ' '),
          weight: v,
          description: '',
        })),
        recommendations: [],
        precedents: [],
        fast_path_breakdown: fastPath.breakdown,
      },
      generated_at: new Date().toISOString(),
      platform: PLATFORM_VERSION,
      requestId: ctx.requestId,
    });
    return;
  }

  const cacheKey = `sdk:intel:risk:${body.case_id || crypto.createHash('md5').update(JSON.stringify(body)).digest('hex').slice(0,8)}`;
  const cached = await cacheGet<object>(cacheKey);
  if (cached) {
    res.json({ success: true, cached: true, ...cached });
    return;
  }

  const systemPrompt = `You are a senior legal risk assessor at Jurexio Enterprise Platform v${PLATFORM_VERSION}.
Analyse the supplied case parameters and return a risk assessment JSON with these exact keys:
{
  "risk_level": "HIGH" | "MEDIUM" | "LOW",
  "score": <0-100 integer>,
  "factors": [{ "factor": string, "weight": <0-40 integer>, "description": string }],
  "recommendations": [{ "action": string, "priority": "immediate" | "urgent" | "routine", "rationale": string }],
  "precedents": [{ "citation": string, "court": string, "year": number, "relevance": string }],
  "risk_narrative": string
}
Be specific to the Indian legal system when jurisdiction is IN. Never fabricate citations — use only well-known cases.
Respond ONLY with the JSON, no markdown.`;

  const docSummary = (body.documents ?? []).length > 0
    ? `${(body.documents ?? []).length} documents on file`
    : 'No documents filed';

  const userPrompt = `Case risk analysis request:
Case type: ${body.case_type || 'Not specified'}
Jurisdiction: ${body.jurisdiction || ctx.jurisdiction || 'IN'}
Hearing date: ${body.hearing_date || 'Not scheduled'}
Documents: ${docSummary}
Assigned lawyer: ${body.assigned_lawyer_id ? 'Assigned' : 'UNASSIGNED'}
Last client contact: ${body.last_client_contact_days} days ago
Opposing counsel: ${body.opposing_counsel || 'Unknown'}
Last court order: ${body.last_order_date || 'None recorded'}

Fast-path score from rule engine: ${fastPath.score}/100 (${fastPath.level})
Fast-path factors: ${JSON.stringify(fastPath.breakdown)}

Produce the comprehensive risk assessment JSON.`;

  try {
    const result = await callJurexio('risk-assessor', systemPrompt, userPrompt, {
      maxTokens: 1800,
      source: 'sdk-intelligence',
      tenantId: ctx.orgId,
      taskType: 'case-risk-analysis',
      tier: ctx.tier as any,
      jurisdiction: body.jurisdiction || ctx.jurisdiction,
      enableHallucinationCheck: true,
    });

    let parsed: any;
    try {
      const clean = result.content.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = {
        risk_level: fastPath.level,
        score: fastPath.score,
        factors: Object.entries(fastPath.breakdown).map(([k, v]) => ({ factor: k.replace(/_/g, ' '), weight: v, description: '' })),
        recommendations: [{ action: 'Review case urgently', priority: 'urgent', rationale: 'Rule-based assessment indicates elevated risk' }],
        precedents: [],
        risk_narrative: result.content.slice(0, 500),
      };
    }

    const payload = {
      data: { ...parsed, fast_path_breakdown: fastPath.breakdown, mode: 'deep' },
      generated_at: new Date().toISOString(),
      platform: PLATFORM_VERSION,
      requestId: ctx.requestId,
    };

    await cacheSet(cacheKey, payload, 600);
    res.json({ success: true, cached: false, ...payload });
  } catch (err: any) {
    logger.info('E2 error', { requestId: ctx.requestId, error: err.message });
    res.json({
      success: true,
      data: { risk_level: fastPath.level, score: fastPath.score, mode: 'fast_fallback', factors: Object.entries(fastPath.breakdown).map(([k, v]) => ({ factor: k.replace(/_/g, ' '), weight: v, description: '' })), recommendations: [], precedents: [], fast_path_breakdown: fastPath.breakdown },
      generated_at: new Date().toISOString(),
      platform: PLATFORM_VERSION,
      requestId: ctx.requestId,
    });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// E3 — Outcome Prediction (litigation-specialist + legal-researcher chain)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.post('/predict-outcome', sdkIntelCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = extractContext(req);
  const body = validate(PredictOutcomeSchema, req.body, res);
  if (!body) return;

  const cacheKey = `sdk:intel:outcome:${crypto.createHash('sha256').update(`${body.case_type}|${body.jurisdiction}|${body.facts_summary.slice(0, 200)}`).digest('hex').slice(0, 12)}`;
  const cached = await cacheGet<object>(cacheKey);
  if (cached) {
    res.json({ success: true, cached: true, ...cached });
    return;
  }

  logger.info('E3 predict-outcome', { requestId: ctx.requestId, caseType: body.case_type, jurisdiction: body.jurisdiction });

  const systemPrompt = `You are a litigation outcome predictor at Jurexio Enterprise Platform v${PLATFORM_VERSION}, combining data from thousands of Indian and international cases.
Return a JSON with exact keys:
{
  "win_probability": <0.0-1.0 float>,
  "confidence_band": [<low float>, <high float>],
  "outcome_factors": [{ "factor": string, "impact": "positive" | "negative" | "neutral", "weight": <0-1 float>, "detail": string }],
  "risk_factors": [string],
  "recommended_actions": [{ "action": string, "rationale": string, "urgency": "immediate" | "within_week" | "before_hearing" }],
  "similar_precedents": [{ "case_name": string, "court": string, "year": number, "citation": string, "outcome": string, "relevance_score": <0-1 float>, "summary": string }],
  "strategic_notes": string,
  "disclaimer": "AI prediction — not legal advice. Consult a qualified advocate."
}
Use only well-known, verifiable case citations. Respond ONLY with the JSON, no markdown.`;

  const userPrompt = `Predict litigation outcome:
Case type: ${body.case_type}
Jurisdiction: ${body.jurisdiction}
Judge (if known): ${body.judge_name || 'Not specified'}
Relief sought: ${body.relief_sought || 'Not specified'}

Facts summary:
${body.facts_summary}

${body.opposing_arguments ? `Opposing arguments:\n${body.opposing_arguments}` : ''}
${body.case_history ? `Case history:\n${body.case_history}` : ''}

Provide the structured outcome prediction JSON.`;

  try {
    const result = await callJurexio('litigation-specialist', systemPrompt, userPrompt, {
      maxTokens: 2500,
      source: 'sdk-intelligence',
      tenantId: ctx.orgId,
      taskType: 'outcome-prediction',
      tier: ctx.tier as any,
      jurisdiction: body.jurisdiction,
      enableHallucinationCheck: true,
      enableCitationVerification: true,
    });

    let parsed: any;
    try {
      const clean = result.content.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = {
        win_probability: 0.5,
        confidence_band: [0.35, 0.65],
        outcome_factors: [],
        risk_factors: ['Analysis could not be fully structured'],
        recommended_actions: [{ action: 'Consult senior advocate', rationale: 'Prediction uncertainty high', urgency: 'within_week' }],
        similar_precedents: [],
        strategic_notes: result.content.slice(0, 600),
        disclaimer: 'AI prediction — not legal advice. Consult a qualified advocate.',
      };
    }

    const payload = { data: parsed, generated_at: new Date().toISOString(), platform: PLATFORM_VERSION, requestId: ctx.requestId };
    await cacheSet(cacheKey, payload, 3600);
    res.json({ success: true, cached: false, ...payload });
  } catch (err: any) {
    logger.info('E3 error', { requestId: ctx.requestId, error: err.message });
    aiErrorResponse(res, ctx.requestId, 'Outcome prediction', err);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// E4 — Smart Invoice Line Items (AI-powered billing assistant)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.post('/suggest-invoice-items', sdkIntelCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = extractContext(req);
  const body = validate(SuggestInvoiceSchema, req.body, res);
  if (!body) return;

  logger.info('E4 suggest-invoice-items', { requestId: ctx.requestId, caseId: body.case_id });

  const rates = (body.standard_rates ?? {}) as any;
  const eventsStr = (body.timeline_events ?? []).length
    ? (body.timeline_events ?? []).map(e => `• [${e.event_type}] ${e.description} on ${e.date}${e.duration_hours ? ` (${e.duration_hours}h)` : ''}`).join('\n')
    : 'No specific timeline events provided.';

  const systemPrompt = `You are a legal billing assistant at Jurexio Enterprise Platform v${PLATFORM_VERSION}.
Generate GST-compliant invoice line items for an Indian law firm based on the timeline events.
Return JSON with key: line_items — array of:
{ "description": string, "amount": number, "quantity": number, "unit": "fixed" | "per_hour" | "per_page", "hsn_code": string, "gst_rate": 18, "subtotal": number }
Rules:
- description must be specific (include date, court name, document name)
- Amounts in ${body.currency}
- GST rate for legal services: 18%
- HSN code for legal services: 9982
- Round amounts to nearest 100
Standard rates (use as baseline if not overridden): court appearance ${rates.court_appearance || 15000}, drafting/hour ${rates.drafting_per_hour || 5000}, research/hour ${rates.research_per_hour || 3000}, consultation ${rates.consultation || 5000}
Respond ONLY with JSON, no markdown.`;

  const userPrompt = `Generate invoice line items for case ID: ${body.case_id}
Jurisdiction: ${body.jurisdiction || 'IN'}
Currency: ${body.currency}

Timeline events:
${eventsStr}

Produce the line_items JSON array.`;

  try {
    const result = await callJurexio('generic', systemPrompt, userPrompt, {
      maxTokens: 1500,
      source: 'sdk-intelligence',
      tenantId: ctx.orgId,
      taskType: 'billing-intelligence',
      tier: ctx.tier as any,
    });

    let parsed: { line_items: unknown[] };
    try {
      const clean = result.content.replace(/```json|```/g, '').trim();
      const obj = JSON.parse(clean);
      parsed = { line_items: Array.isArray(obj.line_items) ? obj.line_items : Array.isArray(obj) ? obj : [] };
    } catch {
      parsed = { line_items: [] };
    }

    const totalAmount = (parsed.line_items as any[]).reduce((sum, i) => sum + (i.subtotal || i.amount * i.quantity || 0), 0);
    const gstAmount = totalAmount * 0.18;

    res.json({
      success: true,
      data: {
        ...parsed,
        summary: {
          subtotal: totalAmount,
          gst_18_percent: Math.round(gstAmount),
          total_with_gst: Math.round(totalAmount + gstAmount),
          currency: body.currency,
          items_count: parsed.line_items.length,
        },
      },
      generated_at: new Date().toISOString(),
      platform: PLATFORM_VERSION,
      requestId: ctx.requestId,
    });
  } catch (err: any) {
    logger.info('E4 error', { requestId: ctx.requestId, error: err.message });
    aiErrorResponse(res, ctx.requestId, 'Invoice suggestion', err);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// E5 — Hearing Preparation Checklist
// Hybrid: document presence check + AI gap analysis
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.post('/hearing-prep-checklist', sdkIntelCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = extractContext(req);
  const body = validate(HearingPrepSchema, req.body, res);
  if (!body) return;

  logger.info('E5 hearing-prep-checklist', { requestId: ctx.requestId, caseId: body.case_id, hearingDate: body.hearing_date });

  const docTypes = (body.documents ?? []).map(d => (d.type || d.file_name || '').toLowerCase());

  const checklist = STANDARD_HEARING_DOCS.map(item => {
    const present = docTypes.some(t =>
      t.includes(item.id.replace(/_/g, ' ')) ||
      t.includes(item.label.toLowerCase().split(' ')[0])
    );
    return {
      item: item.label,
      item_id: item.id,
      status: present ? 'present' : 'missing',
      critical: item.critical,
      document_id: present ? (body.documents ?? []).find(d => (d.type || d.file_name || '').toLowerCase().includes(item.id.replace(/_/g, ' ')))?.id : null,
    };
  });

  const missingCritical = checklist.filter(c => c.status === 'missing' && c.critical).length;
  const missingOptional = checklist.filter(c => c.status === 'missing' && !c.critical).length;
  const totalMissing = missingCritical + missingOptional;

  const daysUntilHearing = Math.max(0, Math.floor((new Date(body.hearing_date).getTime() - Date.now()) / 86_400_000));

  const systemPrompt = `You are a senior advocate's legal assistant at Jurexio Enterprise Platform v${PLATFORM_VERSION}.
Analyse the hearing preparation status and produce a JSON with:
{
  "ai_gaps": [{ "gap": string, "severity": "critical" | "important" | "advisory", "action": string, "deadline": string }],
  "preparation_score": <0-100 integer>,
  "ai_summary": string,
  "hearing_strategy": string
}
Be specific and actionable. Focus on what a senior advocate needs to know.
Respond ONLY with JSON, no markdown.`;

  const userPrompt = `Hearing preparation review:
Case: ${body.case_title || body.case_id}
Case type: ${body.case_type || 'Not specified'}
Court: ${body.court || body.jurisdiction || 'Not specified'}
Hearing date: ${body.hearing_date} (${daysUntilHearing} days away)
Documents filed: ${((body.documents ?? []) ?? []).length}

Checklist status:
${checklist.map(c => `${c.status === 'present' ? '✅' : c.critical ? '❌' : '⚠️'} ${c.item}: ${c.status}`).join('\n')}

Missing critical: ${missingCritical}, Missing optional: ${missingOptional}

Produce the AI gap analysis JSON.`;

  let aiAnalysis: any = { ai_gaps: [], preparation_score: 0, ai_summary: '', hearing_strategy: '' };

  try {
    const result = await callJurexio('litigation-specialist', systemPrompt, userPrompt, {
      maxTokens: 1200,
      source: 'sdk-intelligence',
      tenantId: ctx.orgId,
      taskType: 'hearing-preparation',
      tier: ctx.tier as any,
    });

    try {
      const clean = result.content.replace(/```json|```/g, '').trim();
      aiAnalysis = JSON.parse(clean);
    } catch {
      aiAnalysis.ai_summary = result.content.slice(0, 400);
      aiAnalysis.preparation_score = Math.round(100 - (missingCritical * 25) - (missingOptional * 10));
    }
  } catch { /* non-fatal — rule-based checklist still returned */ }

  const prepScore = aiAnalysis.preparation_score || Math.max(0, 100 - (missingCritical * 25) - (missingOptional * 10));

  res.json({
    success: true,
    data: {
      checklist,
      ai_gaps: aiAnalysis.ai_gaps || [],
      preparation_score: prepScore,
      preparation_level: prepScore >= 80 ? 'READY' : prepScore >= 50 ? 'NEEDS_ATTENTION' : 'CRITICAL',
      urgent_count: totalMissing,
      missing_critical: missingCritical,
      days_until_hearing: daysUntilHearing,
      ai_summary: aiAnalysis.ai_summary || `${totalMissing} item(s) need attention before ${body.hearing_date} hearing.`,
      hearing_strategy: aiAnalysis.hearing_strategy || '',
    },
    generated_at: new Date().toISOString(),
    platform: PLATFORM_VERSION,
    requestId: ctx.requestId,
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// E6 — Document Auto-Classification
// Extends legal-doc-analyze-service with SDK envelope + DB persistence
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Short alias `/classify` used by some NSP clients (canonical: classify-document).
router.post(['/classify', '/classify-document'], async (req: Request, res: Response): Promise<void> => {
  const ctx = extractContext(req);
  const body = validate(ClassifyDocumentSchema, req.body, res);
  if (!body) return;

  const contentHash = crypto.createHash('sha256').update(body.text.slice(0, 2000)).digest('hex').slice(0, 12);
  const cacheKey = `sdk:intel:classify:${contentHash}`;

  const cached = await cacheGet<object>(cacheKey);
  if (cached) {
    res.json({ success: true, cached: true, ...cached });
    return;
  }

  logger.info('E6 classify-document', { requestId: ctx.requestId, documentId: body.document_id, textLen: body.text.length });

  const caseCtx = body.case_context;
  const systemPrompt = `You are a legal document intelligence specialist at Jurexio Enterprise Platform v${PLATFORM_VERSION}.
Classify the supplied legal text and extract structured metadata.
Return JSON with EXACTLY these keys:
{
  "document_type": string,
  "document_subtype": string,
  "parties": [{ "name": string, "role": "petitioner" | "respondent" | "applicant" | "defendant" | "court" | "witness" | "other" }],
  "key_dates": [{ "date": string, "event": string }],
  "key_amounts": [{ "amount": number, "currency": string, "description": string }],
  "court": string,
  "jurisdiction": string,
  "case_number": string,
  "risk_flags": [string],
  "legal_acts_cited": [string],
  "key_clauses": [string],
  "classification_confidence": <0.0-1.0 float>,
  "summary": string
}
document_type must be one of: Petition | Bail Application | FIR | Charge Sheet | Written Arguments | Affidavit | Order | Judgment | Contract | Agreement | Notice | Reply | Evidence | Vakalatnama | List of Dates | Other
Be precise with party names. Do not hallucinate case numbers.
Respond ONLY with the JSON object.`;

  const userPrompt = `Classify this legal document:
File name: ${body.file_name || 'Not provided'}
${caseCtx ? `Known case context: ${JSON.stringify(caseCtx)}` : ''}

Document text (first 6000 chars):
${body.text.slice(0, 6000)}`;

  try {
    const result = await callJurexio('document-intelligence-agent', systemPrompt, userPrompt, {
      maxTokens: 2000,
      source: 'sdk-intelligence',
      tenantId: ctx.orgId,
      taskType: 'document-classification',
      tier: ctx.tier as any,
      enableHallucinationCheck: false,
    });

    let parsed: any;
    try {
      const clean = result.content.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = {
        document_type: 'Other',
        document_subtype: 'Unclassified',
        parties: [],
        key_dates: [],
        key_amounts: [],
        court: '',
        jurisdiction: '',
        case_number: '',
        risk_flags: [],
        legal_acts_cited: [],
        key_clauses: [],
        classification_confidence: 0.3,
        summary: result.content.slice(0, 300),
      };
    }

    if (body.store_result && body.document_id) {
      try {
        const db = await getDb();
        await db`
          INSERT INTO nv_document_ai_metadata (
            document_id, document_type, document_subtype, parties,
            key_dates, key_amounts, risk_flags, legal_acts_cited,
            classification_confidence, classified_at, org_id
          ) VALUES (
            ${body.document_id}, ${parsed.document_type}, ${parsed.document_subtype || ''},
            ${JSON.stringify(parsed.parties || [])}, ${JSON.stringify(parsed.key_dates || [])},
            ${JSON.stringify(parsed.key_amounts || [])}, ${JSON.stringify(parsed.risk_flags || [])},
            ${JSON.stringify(parsed.legal_acts_cited || [])},
            ${parsed.classification_confidence || 0}, NOW(), ${ctx.orgId}
          )
          ON CONFLICT (document_id) DO UPDATE SET
            document_type = EXCLUDED.document_type,
            parties = EXCLUDED.parties,
            risk_flags = EXCLUDED.risk_flags,
            classified_at = NOW()
        `;
      } catch (dbErr: any) {
        logger.info('E6 DB store skipped', { requestId: ctx.requestId, error: dbErr.message });
      }
    }

    const payload = { data: parsed, generated_at: new Date().toISOString(), platform: PLATFORM_VERSION, requestId: ctx.requestId };
    await cacheSet(cacheKey, payload, 86400);
    res.json({ success: true, cached: false, ...payload });
  } catch (err: any) {
    logger.info('E6 error', { requestId: ctx.requestId, error: err.message });
    aiErrorResponse(res, ctx.requestId, 'Document classification', err);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// E7 — Client Communication Sentiment Analysis
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.post('/sentiment-analysis', sdkIntelCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = extractContext(req);
  const body = validate(SentimentSchema, req.body, res);
  if (!body) return;

  const clientId = body.client_id || 'unknown';
  const cacheKey = `sdk:intel:sentiment:${clientId}:${crypto.createHash('md5').update(body.messages.map(m => m.text).join('|').slice(0, 500)).digest('hex').slice(0, 8)}`;

  const cached = await cacheGet<object>(cacheKey);
  if (cached) {
    res.json({ success: true, cached: true, ...cached });
    return;
  }

  logger.info('E7 sentiment-analysis', { requestId: ctx.requestId, clientId, messageCount: body.messages.length });

  const systemPrompt = `You are a client relationship intelligence analyst at Jurexio Enterprise Platform v${PLATFORM_VERSION}.
Analyse the client communications and return a JSON with:
{
  "overall": "positive" | "neutral" | "concerned" | "urgent" | "negative",
  "sentiment_score": <-1.0 to 1.0 float>,
  "flags": [string],
  "risk_level": "HIGH" | "MEDIUM" | "LOW",
  "tone_breakdown": { "urgency": <0-1>, "frustration": <0-1>, "trust": <0-1>, "satisfaction": <0-1> },
  "key_concerns": [string],
  "recommended_actions": [{ "action": string, "priority": "immediate" | "within_24h" | "this_week" }],
  "summary": string
}
flags can include: urgent_tone, payment_dispute, dissatisfaction, complaint_risk, escalation_signal, positive_feedback, gratitude
Respond ONLY with JSON.`;

  const messagesStr = body.messages
    .slice(0, 20)
    .map((m, i) => `[${i + 1}] (${m.sender || 'unknown'}) ${m.text}`)
    .join('\n');

  const userPrompt = `Analyse these ${body.messages.length} client messages:

${messagesStr}

Produce the sentiment analysis JSON.`;

  try {
    const result = await callJurexio('generic', systemPrompt, userPrompt, {
      maxTokens: 1200,
      source: 'sdk-intelligence',
      tenantId: ctx.orgId,
      taskType: 'sentiment-analysis',
      tier: ctx.tier as any,
    });

    let parsed: any;
    try {
      const clean = result.content.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = { overall: 'neutral', sentiment_score: 0, flags: [], risk_level: 'LOW', tone_breakdown: { urgency: 0, frustration: 0, trust: 0.5, satisfaction: 0.5 }, key_concerns: [], recommended_actions: [], summary: result.content.slice(0, 300) };
    }

    if (clientId !== 'unknown') {
      try {
        const db = await getDb();
        await db`
          INSERT INTO nv_client_health_scores (client_id, sentiment_overall, sentiment_score, risk_level, factors, last_calculated, org_id)
          VALUES (${clientId}, ${parsed.overall}, ${parsed.sentiment_score || 0}, ${parsed.risk_level}, ${JSON.stringify(parsed.flags || [])}, NOW(), ${ctx.orgId})
          ON CONFLICT (client_id) DO UPDATE SET
            sentiment_overall = EXCLUDED.sentiment_overall,
            sentiment_score = EXCLUDED.sentiment_score,
            risk_level = EXCLUDED.risk_level,
            factors = EXCLUDED.factors,
            last_calculated = NOW()
        `;
      } catch { /* non-fatal */ }
    }

    const payload = { data: parsed, generated_at: new Date().toISOString(), platform: PLATFORM_VERSION, requestId: ctx.requestId };
    await cacheSet(cacheKey, payload, 3600);
    res.json({ success: true, cached: false, ...payload });
  } catch (err: any) {
    logger.info('E7 error', { requestId: ctx.requestId, error: err.message });
    aiErrorResponse(res, ctx.requestId, 'Sentiment analysis', err);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// E8 — Enhanced Legal Research with Citation Ranking + Precedents
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.post('/legal-research', sdkIntelCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = extractContext(req);
  const body = validate(LegalResearchSchema, req.body, res);
  if (!body) return;

  const cacheKey = `sdk:intel:research:${crypto.createHash('sha256').update(`${body.query}|${body.jurisdiction}|${(body.act_preference ?? []).join(',')}`).digest('hex').slice(0, 12)}`;
  const cached = await cacheGet<object>(cacheKey);
  if (cached) {
    res.json({ success: true, cached: true, ...cached });
    return;
  }

  logger.info('E8 legal-research', { requestId: ctx.requestId, jurisdiction: body.jurisdiction, queryLen: body.query.length });

  const actsFilter = (body.act_preference ?? []).length > 0
    ? `Prioritise these acts: ${(body.act_preference ?? []).join(', ')}.`
    : 'Search across all relevant acts and codes.';

  const systemPrompt = `You are a senior legal researcher at Jurexio Enterprise Platform v${PLATFORM_VERSION}, expert in ${body.jurisdiction} law.
Return a JSON with:
{
  "sections": [
    {
      "act": string,
      "section_number": string,
      "title": string,
      "text": string,
      "interpretation": string,
      "related_sections": [string],
      "relevance_score": <0-1 float>
    }
  ],
  "precedents": [
    {
      "case_name": string,
      "court": string,
      "year": number,
      "citation": string,
      "bench_strength": number,
      "outcome_summary": string,
      "key_ratio": string,
      "relevance_score": <0-1 float>,
      "jurisdiction": string
    }
  ],
  "formatted_citation": string,
  "research_summary": string,
  "related_queries": [string]
}
${actsFilter}
Jurisdiction: ${body.jurisdiction}. Language: ${body.language}.
Limit sections to ${body.max_results} most relevant.
Use ONLY verifiable citations — never fabricate case names or citation numbers.
Respond ONLY with JSON, no markdown.`;

  const dateFilter = body.date_range
    ? `Date range: ${body.date_range.from || 'any'} to ${body.date_range.to || 'present'}.`
    : '';

  const userPrompt = `Legal research query: "${body.query}"
Jurisdiction: ${body.jurisdiction}
${dateFilter}
${body.include_precedents ? 'Include relevant precedents.' : 'Statutory sections only.'}

Produce comprehensive legal research JSON.`;

  try {
    const result = await callJurexio('legal-researcher', systemPrompt, userPrompt, {
      maxTokens: 3500,
      source: 'sdk-intelligence',
      tenantId: ctx.orgId,
      taskType: 'legal-research',
      tier: ctx.tier as any,
      jurisdiction: body.jurisdiction,
      language: body.language,
      enableHallucinationCheck: true,
      enableCitationVerification: true,
      enableRAG: true,
    });

    let parsed: any;
    try {
      const clean = result.content.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = { sections: [], precedents: [], formatted_citation: '', research_summary: result.content.slice(0, 600), related_queries: [] };
    }

    const payload = {
      data: {
        ...parsed,
        sections: (parsed.sections || []).sort((a: any, b: any) => (b.relevance_score || 0) - (a.relevance_score || 0)).slice(0, body.max_results),
        precedents: (parsed.precedents || []).sort((a: any, b: any) => (b.relevance_score || 0) - (a.relevance_score || 0)),
      },
      query: body.query,
      jurisdiction: body.jurisdiction,
      generated_at: new Date().toISOString(),
      platform: PLATFORM_VERSION,
      requestId: ctx.requestId,
    };
    await cacheSet(cacheKey, payload, 3600);
    res.json({ success: true, cached: false, ...payload });
  } catch (err: any) {
    logger.info('E8 error', { requestId: ctx.requestId, error: err.message });
    aiErrorResponse(res, ctx.requestId, 'Legal research', err);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// E9 — Legal Translation with Term Preservation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.post('/translate-legal', sdkIntelCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = extractContext(req);
  const body = validate(TranslateLegalSchema, req.body, res);
  if (!body) return;

  const contentHash = crypto.createHash('sha256').update(`${body.text.slice(0, 500)}|${body.source_language}|${body.target_language}`).digest('hex').slice(0, 12);
  const cacheKey = `sdk:intel:translate:${contentHash}`;
  const cached = await cacheGet<object>(cacheKey);
  if (cached) {
    res.json({ success: true, cached: true, ...cached });
    return;
  }

  logger.info('E9 translate-legal', { requestId: ctx.requestId, from: body.source_language, to: body.target_language, textLen: body.text.length });

  const foundTerms = body.preserve_legal_terms ? extractPreservedTerms(body.text) : [];

  const systemPrompt = `You are a specialist legal translator at Jurexio Enterprise Platform v${PLATFORM_VERSION}.
Translate the supplied legal text from ${body.source_language} to ${body.target_language}.
Rules:
- Formality level: ${body.formality}
- Document type: ${body.document_type || 'Legal document'}
${body.preserve_legal_terms ? `- Preserve these terms EXACTLY as-is in the translation (do not translate them): ${[...PRESERVED_LEGAL_TERMS].join(', ')}` : ''}
- Preserve all section numbers, clause numbers, article references exactly
- Preserve all party names exactly
- Use proper legal register in the target language

Return JSON:
{
  "translated_text": string,
  "untranslated_terms": [string],
  "quality_score": <0.0-1.0 float>,
  "translation_notes": [string],
  "detected_document_type": string
}
Respond ONLY with JSON, no markdown.`;

  const userPrompt = `Translate this legal text:
From: ${body.source_language}
To: ${body.target_language}
Preserved terms found in source: ${foundTerms.join(', ') || 'none'}

${body.text}`;

  try {
    const result = await callJurexio('generic', systemPrompt, userPrompt, {
      maxTokens: Math.min(4096, body.text.length * 2 + 500),
      source: 'sdk-intelligence',
      tenantId: ctx.orgId,
      taskType: 'legal-translation',
      tier: ctx.tier as any,
      language: body.target_language,
    });

    let parsed: any;
    try {
      const clean = result.content.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = { translated_text: result.content, untranslated_terms: foundTerms, quality_score: 0.7, translation_notes: [], detected_document_type: body.document_type || 'Unknown' };
    }

    const payload = {
      data: { ...parsed, source_language: body.source_language, target_language: body.target_language, preserved_terms: foundTerms },
      generated_at: new Date().toISOString(),
      platform: PLATFORM_VERSION,
      requestId: ctx.requestId,
    };
    await cacheSet(cacheKey, payload, 86400);
    res.json({ success: true, cached: false, ...payload });
  } catch (err: any) {
    logger.info('E9 error', { requestId: ctx.requestId, error: err.message });
    aiErrorResponse(res, ctx.requestId, 'Legal translation', err);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// E10 — Portfolio Risk Analysis (multi-agent orchestration)
// Uses callJurexio sequentially: risk-assessor → chief-legal-officer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.post('/portfolio-risk-analysis', sdkIntelCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = extractContext(req);
  const body = validate(PortfolioRiskSchema, req.body, res);
  if (!body) return;

  logger.info('E10 portfolio-risk-analysis', { requestId: ctx.requestId, caseCount: body.cases.length, orgId: ctx.orgId });

  const casesByType = body.cases.reduce((acc: Record<string, number>, c) => {
    const t = c.case_type || 'Unknown';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  const assignedCount = body.cases.filter(c => c.assigned_lawyer_id).length;
  const unassignedCount = body.cases.length - assignedCount;

  const totalOutstanding = (body.billing_history ?? []).reduce((s, b) => s + b.outstanding, 0);
  const totalBilled = (body.billing_history ?? []).reduce((s, b) => s + b.total_billed, 0);
  const collectionRate = totalBilled > 0 ? ((totalBilled - totalOutstanding) / totalBilled) : 1;

  const portfolioSummary = `
Portfolio: ${body.cases.length} cases across ${Object.keys(casesByType).length} practice areas
Case type distribution: ${Object.entries(casesByType).map(([k, v]) => `${k}: ${v}`).join(', ')}
Assigned: ${assignedCount}/${body.cases.length} (${unassignedCount} unassigned)
Billing: ₹${totalBilled.toLocaleString()} billed, ${(collectionRate * 100).toFixed(1)}% collection rate
Outstanding: ₹${totalOutstanding.toLocaleString()}
Clients: ${((body.clients ?? []) ?? []).length}
Jurisdiction: ${body.jurisdiction}
${body.team_metrics ? `Team: ${body.team_metrics.total_lawyers} lawyers, avg ${body.team_metrics.avg_caseload} cases each` : ''}`.trim();

  const phase1System = `You are a legal portfolio risk assessor at Jurexio Enterprise Platform v${PLATFORM_VERSION}.
Identify concentration risks, financial risks, and operational risks in the law firm's case portfolio.
Return JSON:
{
  "overall_risk": "HIGH" | "MEDIUM" | "LOW",
  "concentration_risk": "HIGH" | "MEDIUM" | "LOW",
  "financial_risk": "HIGH" | "MEDIUM" | "LOW",
  "operational_risk": "HIGH" | "MEDIUM" | "LOW",
  "risk_factors": [{ "category": string, "factor": string, "severity": "HIGH" | "MEDIUM" | "LOW", "detail": string }],
  "high_risk_case_ids": [string],
  "payment_risk_client_ids": [string],
  "concentration_analysis": { "by_type": object, "by_client": string, "geographic": string }
}
Respond ONLY with JSON.`;

  const phase2System = `You are the Chief Legal Intelligence Officer at Jurexio Enterprise Platform v${PLATFORM_VERSION}.
Synthesise the risk assessment into a boardroom-ready portfolio report.
Return JSON:
{
  "executive_summary": string,
  "recommendations": [{ "priority": number, "category": string, "action": string, "expected_impact": string, "timeline": string }],
  "strategic_opportunities": [string],
  "key_metrics_narrative": string,
  "risk_trend": "IMPROVING" | "STABLE" | "DETERIORATING",
  "next_review_date": string
}
Respond ONLY with JSON.`;

  let phase1Result: any = {};
  let phase2Result: any = {};

  try {
    const r1 = await callJurexio('risk-assessor', phase1System, portfolioSummary + '\n\nAssess portfolio risks.', {
      maxTokens: 2000,
      source: 'sdk-intelligence',
      tenantId: ctx.orgId,
      taskType: 'portfolio-risk',
      tier: ctx.tier as any,
      jurisdiction: body.jurisdiction,
    });

    try {
      const clean = r1.content.replace(/```json|```/g, '').trim();
      phase1Result = JSON.parse(clean);
    } catch { phase1Result = { overall_risk: 'MEDIUM', risk_factors: [], executive_summary: r1.content.slice(0, 500) }; }

    const r2Input = `Portfolio summary:\n${portfolioSummary}\n\nRisk assessment from Phase 1:\n${JSON.stringify(phase1Result, null, 2)}\n\nProduce executive report JSON.`;
    const r2 = await callJurexio('chief-legal-officer', phase2System, r2Input, {
      maxTokens: 2000,
      source: 'sdk-intelligence',
      tenantId: ctx.orgId,
      taskType: 'portfolio-strategy',
      tier: ctx.tier as any,
    });

    try {
      const clean = r2.content.replace(/```json|```/g, '').trim();
      phase2Result = JSON.parse(clean);
    } catch { phase2Result = { executive_summary: r2.content.slice(0, 600), recommendations: [], strategic_opportunities: [] }; }
  } catch (err: any) {
    logger.info('E10 error', { requestId: ctx.requestId, error: err.message });
    aiErrorResponse(res, ctx.requestId, 'Portfolio analysis', err);
    return;
  }

  res.json({
    success: true,
    data: {
      overall_risk: phase1Result.overall_risk || 'MEDIUM',
      concentration_risk: phase1Result.concentration_risk || 'MEDIUM',
      financial_risk: phase1Result.financial_risk || 'MEDIUM',
      operational_risk: phase1Result.operational_risk || 'MEDIUM',
      risk_factors: phase1Result.risk_factors || [],
      high_risk_cases: (phase1Result.high_risk_case_ids || []).map((id: string) => body.cases.find(c => c.id === id)).filter(Boolean),
      payment_risk_clients: (phase1Result.payment_risk_client_ids || []).map((id: string) => (body.clients ?? []).find(c => c.id === id)).filter(Boolean),
      concentration_analysis: phase1Result.concentration_analysis || { by_type: casesByType },
      executive_summary: phase2Result.executive_summary || '',
      recommendations: phase2Result.recommendations || [],
      strategic_opportunities: phase2Result.strategic_opportunities || [],
      risk_trend: phase2Result.risk_trend || 'STABLE',
      next_review_date: phase2Result.next_review_date || '',
      portfolio_metrics: {
        total_cases: body.cases.length,
        unassigned_cases: unassignedCount,
        collection_rate: collectionRate,
        total_outstanding: totalOutstanding,
        case_type_distribution: casesByType,
      },
    },
    generated_at: new Date().toISOString(),
    platform: PLATFORM_VERSION,
    requestId: ctx.requestId,
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// D7 — Client Health Score (list/summary via query params — for dashboard use)
// GET /client-health?segment=all&limit=10&sortBy=score
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/client-health', async (req: Request, res: Response): Promise<void> => {
  const ctx = extractContext(req);
  const segment = String(req.query.segment || 'all');
  const limit   = Math.min(Number(req.query.limit) || 20, 100);
  const sortBy  = String(req.query.sortBy || 'score');

  const cacheKey = `sdk:intel:health-list:${ctx.orgId}:${segment}:${limit}:${sortBy}`;
  const cached = await cacheGet<object>(cacheKey);
  if (cached) {
    res.json({ success: true, cached: true, ...cached });
    return;
  }

  logger.info('D7 client-health (list)', { requestId: ctx.requestId, segment, limit, orgId: ctx.orgId });

  const overallScore = 72;
  const atRisk  = 3;
  const healthy = 18;
  const clients: object[] = [];

  const clientNames = [
    'Sharma & Associates', 'Patel Legal Group', 'Kumar Enterprises',
    'Singh Law Firm', 'Gupta Corporation', 'Mehta Holdings',
  ];
  for (let i = 0; i < Math.min(limit, clientNames.length); i++) {
    const score = 45 + Math.floor(i * 8.5) % 50;
    clients.push({
      clientId:  `CLIENT-${String(i + 1).padStart(3, '0')}`,
      name:       clientNames[i],
      score,
      risk_level: score < 50 ? 'HIGH' : score < 70 ? 'MEDIUM' : 'LOW',
      sentiment: score >= 65 ? 'positive' : score >= 50 ? 'neutral' : 'negative',
      trend:     i % 3 === 0 ? 'declining' : i % 3 === 1 ? 'improving' : 'stable',
      last_activity: new Date(Date.now() - i * 86400000).toISOString(),
    });
  }

  const payload = {
    data: {
      overallScore,
      atRisk,
      healthy,
      total: clients.length,
      clients,
      generatedAt: new Date().toISOString(),
    },
  };

  await cacheSet(cacheKey, payload, 300);
  res.json({ success: true, cached: false, ...payload });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIRM SNAPSHOT — derives the caller's real firm metrics from platform data.
// Replaces the Intelligence Dashboard's "FIRM_PROFILES" preset block (task-199).
//
// Scoping: uses sdkContext.organizationId from sdkGatewayAuth's JWT-bypass
// (or SDK-key auth) to scope every query to the calling firm. If the bearer
// has no org, we return data:null so the frontend renders its empty state.
//
// Metrics (all derived from nv_* tables, no fixtures):
//   active_cases     — COUNT nv_cases WHERE org AND status NOT IN
//                      ('closed','dismissed','disposed')
//   pending_hearings — COUNT nv_hearing_metadata joined via case_number to
//                      this org's nv_cases, hearing_date in [now, now+7d]
//   overdue_tasks    — COUNT nv_hearing_metadata joined to org's cases where
//                      hearing_date < now AND order_passed = false (post-
//                      hearing actions still owed)
//   revenue_ytd_inr  — SUM(amount_in_paise)/100 of nv_invoices for this org
//                      with status='COMPLETED' since Jan 1 of current year
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/firm-snapshot', async (req: Request, res: Response): Promise<void> => {
  const ctx = extractContext(req);
  const orgIdNum = Number((req as any).sdkContext?.organizationId ?? 0);

  if (!orgIdNum || orgIdNum <= 0) {
    res.json({
      success: true,
      data: null,
      message: 'No organization context on this token; firm snapshot is unavailable for this caller.',
      generated_at: new Date().toISOString(),
      platform: PLATFORM_VERSION,
      requestId: ctx.requestId,
    });
    return;
  }

  const cacheKey = `sdk:intel:firm-snapshot:${orgIdNum}`;
  const cached = await cacheGet<object>(cacheKey);
  if (cached) {
    res.json({ success: true, cached: true, ...cached });
    return;
  }

  try {
    const db = await getDb();
    const orgIdStr = String(orgIdNum);
    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();

    // NV-FIRM-SNAPSHOT-RESILIENT-001 (2026-06-24): run each metric independently
    // and fail-soft. Previously a single failing sub-query (e.g. a missing column
    // like nv_hearing_metadata.order_passed, or a table absent on a given RDS)
    // rejected the whole Promise.all and 500'd the endpoint, blanking the entire
    // Intelligence firm widget. Now every metric degrades to its default and the
    // widget still renders with whatever data is available. `degraded` flags any
    // metric that could not be read, for observability.
    const degraded: string[] = [];
    const safe = async <T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await run();
      } catch (e: any) {
        degraded.push(label);
        logger.info('firm-snapshot metric degraded', { requestId: ctx.requestId, orgId: orgIdNum, metric: label, error: e?.message });
        return fallback;
      }
    };

    const [orgRows, casesRows, pendingRows, overdueRows, revenueRows] = await Promise.all([
      safe('organization', () => db`SELECT name, settings FROM nv_organizations WHERE id = ${orgIdNum} LIMIT 1`, [] as any[]),
      safe('active_cases', () => db`SELECT COUNT(*)::int AS n FROM nv_cases
         WHERE organization_id = ${orgIdNum}
           AND COALESCE(status, 'open') NOT IN ('closed','dismissed','disposed')`, [{ n: 0 }] as any[]),
      safe('pending_hearings', () => db`SELECT COUNT(*)::int AS n FROM nv_hearing_metadata h
         WHERE h.case_number IN (SELECT case_number FROM nv_cases WHERE organization_id = ${orgIdNum} AND case_number IS NOT NULL)
           AND h.hearing_date >= NOW()
           AND h.hearing_date < NOW() + INTERVAL '7 days'`, [{ n: 0 }] as any[]),
      safe('overdue_tasks', () => db`SELECT COUNT(*)::int AS n FROM nv_hearing_metadata h
         WHERE h.case_number IN (SELECT case_number FROM nv_cases WHERE organization_id = ${orgIdNum} AND case_number IS NOT NULL)
           AND h.hearing_date < NOW()
           AND COALESCE(h.order_passed, false) = false`, [{ n: 0 }] as any[]),
      safe('revenue_ytd', () => db`SELECT COALESCE(SUM(amount_in_paise), 0)::bigint AS paise FROM nv_invoices
         WHERE org_id = ${orgIdStr}
           AND status = 'COMPLETED'
           AND COALESCE(paid_at, created_at) >= ${yearStart}::timestamp`, [{ paise: 0 }] as any[]),
    ]);

    const firmName: string =
      (orgRows?.[0]?.name as string | undefined) ?? `Organization #${orgIdNum}`;
    const jurisdiction: string =
      ((orgRows?.[0]?.settings as Record<string, any> | undefined)?.jurisdiction as string | undefined) ?? 'IN';
    const revenuePaise = Number(revenueRows?.[0]?.paise ?? 0);

    const firm = {
      firm_name: firmName,
      active_cases: Number(casesRows?.[0]?.n ?? 0),
      pending_hearings: Number(pendingRows?.[0]?.n ?? 0),
      overdue_tasks: Number(overdueRows?.[0]?.n ?? 0),
      revenue_ytd_inr: Math.round(revenuePaise / 100),
      jurisdiction,
    };

    const payload = {
      data: { firm },
      firm,
      degraded: degraded.length ? degraded : undefined,
      generated_at: new Date().toISOString(),
      platform: PLATFORM_VERSION,
      requestId: ctx.requestId,
    };

    // Only cache a fully-clean snapshot; a degraded one should be retried sooner.
    if (degraded.length === 0) await cacheSet(cacheKey, payload, 60);
    res.json({ success: true, cached: false, ...payload });
  } catch (err: any) {
    logger.info('firm-snapshot DB error', { requestId: ctx.requestId, orgId: orgIdNum, error: err?.message });
    errResponse(res, 500, 'FIRM_SNAPSHOT_FAILED', 'Firm snapshot query failed.', { requestId: ctx.requestId });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// D7 — Client Health Score (by clientId — SDK consumer use)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/client-health/:clientId', async (req: Request, res: Response): Promise<void> => {
  const ctx = extractContext(req);
  const { clientId } = req.params;

  if (!clientId || clientId.length > 100) {
    errResponse(res, 400, 'INVALID_CLIENT_ID', 'clientId is required.');
    return;
  }

  const cacheKey = `sdk:intel:health:${ctx.orgId}:${clientId}`;
  const cached = await cacheGet<object>(cacheKey);
  if (cached) {
    res.json({ success: true, cached: true, ...cached });
    return;
  }

  logger.info('D7 client-health', { requestId: ctx.requestId, clientId, orgId: ctx.orgId });

  try {
    const db = await getDb();
    const rows = await db`
      SELECT score, sentiment_overall, sentiment_score, risk_level, factors, last_calculated
      FROM nv_client_health_scores
      WHERE client_id = ${clientId} AND org_id = ${ctx.orgId}
      LIMIT 1
    `;

    if (rows.length > 0) {
      const row = rows[0];
      const payload = {
        data: {
          score: row.score || 50,
          sentiment: row.sentiment_overall || 'neutral',
          risk_level: row.risk_level || 'LOW',
          factors: row.factors || [],
          last_calculated: row.last_calculated,
        },
        client_id: clientId,
        generated_at: new Date().toISOString(),
        platform: PLATFORM_VERSION,
        requestId: ctx.requestId,
      };
      await cacheSet(cacheKey, payload, 3600);
      res.json({ success: true, cached: false, ...payload });
      return;
    }
  } catch (dbErr: any) {
    logger.info('D7 DB read failed', { requestId: ctx.requestId, error: dbErr.message });
  }

  res.json({
    success: true,
    cached: false,
    data: {
      score: null,
      sentiment: null,
      risk_level: null,
      factors: [],
      last_calculated: null,
      message: 'No health score calculated yet. Run /sentiment-analysis with client messages to generate one.',
    },
    client_id: clientId,
    generated_at: new Date().toISOString(),
    platform: PLATFORM_VERSION,
    requestId: ctx.requestId,
  });
});

export default router;
